import{test}from'node:test';import assert from'node:assert/strict';import*as codec from'../js/generated/housing-columns.mjs';import{packContractDetails,restoreDetails}from'../js/housing-contract-detail.mjs';
const raw={aptSeq:'11110-1',area:59.001,buildYear:1991,cancelDate:'2026-09-03',cancelled:true,category:'monthly',contractTerm:'26.09~28.08',contractType:'갱신',date:'2026-09-01',deposit:10000.25,dong:'동',entityId:'11110-1',floor:-1,identityStatus:'source',jibun:'91',kind:'rent',monthlyRent:0.25,name:'이름',previousDeposit:9000.25,previousMonthlyRent:null,price:null,property:'apartment',renewalRight:'사용'};
const f=['11110:0','59.001',20260901,10000.25,0.25,2,-1,1,null,null,null,null,null,null,0,null,null,'ab'.repeat(10)],table={complexes:{'11110:0':{id:'11110-1'}}};
test('contract references preserve duplicates, exact extras and display variants',()=>{const p=packContractDetails([raw,{...raw,dong:'다른 동'}],[f,f],table,codec);assert.equal(p.matched,2);assert.equal(p.unmatchedCount,0);const rows=restoreDetails(p.details,p.unmatched,p.display,[f,f],table,codec);assert.deepEqual(rows.map(r=>r.dong).sort(),['다른 동','동']);assert.deepEqual(rows.map(r=>({...r,dong:'동'})),[raw,raw]);assert.throws(()=>restoreDetails(p.details,p.unmatched,{},[f,f],table,codec));});
test('ineligible source rows are preserved explicitly, never silently discarded',()=>{const p=packContractDetails([raw],[],table,codec);assert.equal(p.unmatchedCount,1);assert.deepEqual(restoreDetails(p.details,p.unmatched,p.display,[],table,codec),[raw]);});
test('display-only edits do not alter contract fact references or extras',()=>{const a=packContractDetails([raw],[f],table,codec),b=packContractDetails([{...raw,name:'새 이름',buildYear:2000}],[f],table,codec);assert.deepEqual(a.details,b.details);assert.notDeepEqual(a.display,b.display);});
test('unexpected fields, truncated data and money precision loss fail',()=>{assert.throws(()=>packContractDetails([{...raw,unknown:1}],[f],table,codec));const p=packContractDetails([raw],[f],table,codec);assert.throws(()=>restoreDetails(p.details.slice(0,-1),p.unmatched,p.display,[f],table,codec));});

import{retainUnconvertedContracts}from'./build-housing-details.mjs';import{mkdtempSync,mkdirSync,writeFileSync,rmSync,realpathSync}from'node:fs';import{tmpdir}from'node:os';import{join,dirname,sep}from'node:path';
import{createHash}from'node:crypto';
test('rowhouse supersession preserves every duplicate and unmatched row and retains 72 other scopes',()=>{
 const root=mkdtempSync(join(tmpdir(),'housing-retention-'));try{
  const hash=b=>createHash('sha256').update(b).digest('hex'),put=(p,v)=>{const b=Buffer.from(JSON.stringify(v));mkdirSync(dirname(join(root,p)),{recursive:true});writeFileSync(join(root,p),b);return hash(b);};
  const row={...raw,aptSeq:'',entityId:'trh_00000000000000000000000000000001',property:'rowhouse'},rows=[row,row,{...row,deposit:9}],types={complexes:{'11110:0':{id:row.entityId}}},packed=packContractDetails(rows,[f,f],types,codec);
  const canonical=r=>JSON.stringify(Object.fromEntries(Object.keys(r).sort().map(k=>[k,r[k]])));assert.equal(packed.matched,2);assert.equal(packed.unmatchedCount,1);assert.deepEqual(restoreDetails(packed.details,packed.unmatched,packed.display,[f,f],types,codec).map(canonical).sort(),rows.map(canonical).sort());
  const old={service:'rowhouse-rent',lawd:'11110',month:'202609',path:'rowhouse-rent/11110/202609.json',count:3},path='data/contracts/'+old.path,digest=put(path,{rows}),converted={...old,path:old.path.replace('.json','.bin'),format:'regional-reference'},prior={schema:2,sources:{[path]:digest},partitions:[old]};
  for(const lawd of ['28110','28140','28170','28177','28200','28260'])for(let month=1;month<=12;month++){const ym='2025'+String(month).padStart(2,'0'),p={service:'rowhouse-rent',lawd,month:ym,path:`rowhouse-rent/${lawd}/${ym}.json`,count:1};prior.partitions.push(p);prior.sources['data/contracts/'+p.path]=put('data/contracts/'+p.path,{rows:[{...row,date:ym.slice(0,4)+'-'+ym.slice(4)+'-01'}]});}
  put('data/contracts/index.json',prior);const manifest={sources:{},partitions:[converted]},emitted=new Map(),result=retainUnconvertedContracts(root,manifest,(p,b)=>emitted.set(p,b),{[path]:digest});
  assert.equal(result.files,72);assert.equal(manifest.partitions.length,73);assert.equal(emitted.has(path),false);assert.deepEqual(result.superseded,{[path]:digest});assert.equal(Object.hasOwn(manifest.sources,path),false);result.verify();
  for(const change of [{},{[path]:'wrong'}])assert.throws(()=>retainUnconvertedContracts(root,{sources:{},partitions:[converted]},()=>{},change),/exact converted source/);
  assert.throws(()=>retainUnconvertedContracts(root,{sources:{},partitions:[{...converted,count:2}]},()=>{},{[path]:digest}),/exact converted source/);
  const last=prior.partitions.at(-1);put('data/contracts/'+last.path,{rows:[{...row,date:'2025-12-01',deposit:1}]});assert.throws(()=>result.verify(),/input changed/);assert.throws(()=>retainUnconvertedContracts(root,{sources:{},partitions:[converted]},()=>{},{[path]:digest}),/evidence mismatch/);
 }finally{const target=realpathSync(root),parent=realpathSync(tmpdir());if(!target.startsWith(parent+sep)||!target.slice(parent.length+1).startsWith('housing-retention-'))throw Error('Unsafe test cleanup');rmSync(target,{recursive:true,force:true});}
});
test('month rollover retains unrelated contracts exactly without recreating apartment raw files',()=>{
 const root=mkdtempSync(join(tmpdir(),'housing-retention-'));try{
  const old={service:'officetel-rent',lawd:'11110',month:'202510',path:'officetel-rent/11110/202510.json',count:1},current={...old,month:'202511',path:'officetel-rent/11110/202511.json'},apt={...old,service:'apartment-rent',path:'apartment-rent/11110/202510.json'};
  const put=(p,v)=>{mkdirSync(dirname(join(root,p)),{recursive:true});writeFileSync(join(root,p),JSON.stringify(v));};put('data/contracts/index.json',{schema:1,partitions:[old,current,apt]});put('data/contracts/'+old.path,{rows:[{date:'2025-10-03',area:59.001,deposit:125}]});
  const manifest={sources:{},partitions:[current]},emitted=new Map(),result=retainUnconvertedContracts(root,manifest,(p,b)=>emitted.set(p,b));assert.equal(result.files,1);assert.deepEqual(manifest.partitions,[old,current]);assert.deepEqual([...emitted.keys()],['data/contracts/'+old.path]);result.verify();put('data/contracts/'+old.path,{rows:[]});assert.throws(()=>result.verify(),/input changed/);assert.throws(()=>retainUnconvertedContracts(root,{sources:{},partitions:[current]},()=>{}),/evidence mismatch/);
 }finally{const target=realpathSync(root),parent=realpathSync(tmpdir());if(!target.startsWith(parent+sep)||!target.slice(parent.length+1).startsWith('housing-retention-'))throw Error('Unsafe test cleanup');rmSync(target,{recursive:true,force:true});}
});

test('selected rowhouse contracts preserve real UUID and type without creating aptSeq',()=>{const id='trh_00000000000000000000000000000001',row={...raw,aptSeq:'',entityId:id,property:'rowhouse'},types={complexes:{'11110:0':{id,property_type:'rowhouse'}}},p=packContractDetails([row],[f],types,codec);assert.equal(p.matched,1);assert.deepEqual(restoreDetails(p.details,p.unmatched,p.display,[f],types,codec),[row]);const old=packContractDetails([raw],[f],table,codec);assert.equal(Object.values(old.display)[0].property,undefined);});

import{createContractReader}from'../js/housing-contracts.mjs';
test('browser contract reader restores typed references and rejects service path substitution',async()=>{const id='trh_00000000000000000000000000000001',rawRow={...raw,aptSeq:'',entityId:id,property:'rowhouse'},table={complexes:{'11110:0':{id}}},v=packContractDetails([rawRow],[f],table,codec),prefix='data/contracts/rowhouse-rent/11110/',p={service:'rowhouse-rent',lawd:'11110',month:'202609',path:'rowhouse-rent/11110/202609.bin',format:'regional-reference',count:1,regionCodes:['11110'],details:prefix+'202609-details.bin',unmatched:null,display:prefix+'display.json'},values=new Map([[p.details,v.details],[p.display,{dictionary:Object.values(v.display),refs:Object.fromEntries(Object.keys(v.display).map((k,i)=>[k,i]))}]]),r=createContractReader({schema:2,sources:{},rentalVersion:'v'}, {...table,version:'v',regionMonth:async()=>({rows:[f]})},async p=>values.get(p));const result=await r.read(p);const {recordIdentity,recordOccurrence,...rest}=result.rows[0];assert.deepEqual(rest,rawRow);await assert.rejects(r.read({...p,path:'other',details:p.details.replace('rowhouse-rent','apartment-rent')}),/path mismatch/);});
import vm from'node:vm';import{readFileSync}from'node:fs';
// Run the real contract page script against a minimal DOM. A path:null month must render as a loaded zero month.
async function renderContracts(manifest,files,source=readFileSync(new URL('../js/contracts.js',import.meta.url),'utf8')){
 const elements=new Map(),fetched=[],node=()=>({value:'',textContent:'',children:[],options:[],disabled:false,selectedIndex:0,append(...c){this.children.push(...c);},replaceChildren(...c){this.children=c;this.options=c;},add(o){this.options.push(o);if(this.value==='')this.value=o.value;}});
 const $=id=>{if(!elements.has(id))elements.set(id,node());return elements.get(id);};$('period').value='recent';
 const text=e=>e.textContent+e.children.map(text).join('|');
 const context={URLSearchParams,window:{addEventListener(){}},document:{getElementById:$,createElement:node},location:{search:'?property=officetel&category=all-rent&lawd=11110'},sessionStorage:{getItem(){return null;},setItem(){}},performance:{getEntriesByType:()=>[]},Option:function(text,value){return{text,value};},
  NodoApartmentSearch:{bind:()=>({checkScope(){},reportCount(){},restore:async()=>{},clear(){}})},
  fetch:async url=>{fetched.push(url);if(url==='/data/contracts/index.json')return{ok:true,json:async()=>structuredClone(manifest)};const name=url.slice('/data/contracts/'.length);return files.has(name)?{ok:true,json:async()=>JSON.parse(files.get(name))}:{ok:false};}};
 vm.runInNewContext(source,context);
 const settle=async()=>{for(let i=0;i<50;i++)await new Promise(r=>setImmediate(r));},view=()=>Object.fromEntries(['status','selection','rows','trend','page'].map(id=>[id,text($(id))]));
 await settle();
 return {fetched,view:view(),async period(value){$('period').value=value;$('period').onchange();await settle();return view();}};
}
test('contract page renders a path:null month exactly like an empty month file without requesting it',async()=>{
 const now=new Date(),ym=i=>{const d=new Date(now.getFullYear(),now.getMonth()-i,1);return`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}`;},[m0,m1,m2]=[ym(0),ym(1),ym(2)];
 const row=(month,deposit)=>({date:`${month.slice(0,4)}-${month.slice(4)}-05`,area:24.5,category:'jeonse',kind:'rent',deposit,entityId:'off-1',name:'오피스텔',dong:'동',jibun:'1',property:'officetel'});
 const part=(month,count)=>({service:'officetel-rent',lawd:'11110',month,count,checkedAt:'2026-11-17T00:00:00Z',path:`officetel-rent/11110/${month}.json`});
 const files=new Map([[`officetel-rent/11110/${m0}.json`,JSON.stringify({rows:[row(m0,100)]})],[`officetel-rent/11110/${m1}.json`,'{"rows":[]}'],[`officetel-rent/11110/${m2}.json`,JSON.stringify({rows:[row(m2,90),row(m2,80)]})]]);
 const base={schema:2,districts:{'11110':['서울','종로구']},partitions:[part(m0,1),part(m1,0),part(m2,2)]};
 const withFile=await renderContracts(base,files),withNull=await renderContracts({...base,partitions:[part(m0,1),{...part(m1,0),path:null},part(m2,2)]},new Map([...files].filter(([p])=>!p.includes(m1))));
 assert.deepEqual(withNull.view,withFile.view);assert.match(withFile.view.status,/3개월 자료/);
 assert.equal(withFile.fetched.some(u=>u.includes(m1)),true);assert.equal(withNull.fetched.some(u=>u.includes(m1)),false);
});
import{officetelState,officetelPartition,writeOfficetelBundles}from'./build-housing-details.mjs';import{execFileSync}from'node:child_process';
// Build stage 1 (bundles + month files) and stage 2 (bundles only) from month files with the real
// generator helpers. Stage 3 is the next stage 2 run that retains from stage 2 bundles.
function officetelStages(root,months,rowsFor,queryStartMonth){
 const hash=b=>createHash('sha256').update(b).digest('hex'),write=(dir,p,b)=>{mkdirSync(dirname(join(dir,p)),{recursive:true});writeFileSync(join(dir,p),b);return hash(b);};
 const part=m=>({service:'officetel-rent',lawd:'11110',month:m,count:rowsFor(m).length,checkedAt:'2026-11-17T00:00:00Z',path:`officetel-rent/11110/${m}.json`});
 const monthFile=m=>Buffer.from(JSON.stringify({rows:rowsFor(m)})),current=months.filter(m=>m>=queryStartMonth);
 const stage0={schema:2,queryStartMonth,districts:{'11110':['서울','종로구']},sources:{},partitions:months.map(part)};
 const files0=new Map(months.map(m=>[part(m).path,monthFile(m).toString()]));
 for(const m of months)stage0.sources['data/contracts/'+part(m).path]=write(join(root,'stage0'),'data/contracts/'+part(m).path,monthFile(m));write(join(root,'stage0'),'data/contracts/index.json',JSON.stringify(stage0));
 const build=(prior,out,monthFiles)=>{
  const state=officetelState({monthFiles}),retired={},emitted=new Map(),manifest={schema:2,queryStartMonth,districts:stage0.districts,sources:{},partitions:[]},emit=(p,b)=>{emitted.set(p,b);manifest.sources[p]=hash(b);};
  for(const m of current)manifest.partitions.push(officetelPartition(part(m),monthFile(m),state,manifest.sources,retired));
  // Current month files come from the generated source; a stage 2 run retires them.
  if(monthFiles)for(const m of current)emitted.set('data/contracts/'+part(m).path,monthFile(m));
  const retained=retainUnconvertedContracts(prior,manifest,emit,retired,state);writeOfficetelBundles(manifest,state,emit);
  for(const[p,b]of emitted)write(out,p,b);write(out,'data/contracts/index.json',JSON.stringify(manifest));
  return {manifest,files:new Map([...emitted].map(([p,b])=>[p.slice('data/contracts/'.length),b.toString()])),retired,state,retained};
 };
 const stage1=build(join(root,'stage0'),join(root,'stage1'),true),stage2=build(join(root,'stage1'),join(root,'stage2'),false),stage3=build(join(root,'stage2'),join(root,'stage3'),false);
 return {stage0:{manifest:stage0,files:files0},stage1,stage2,stage3};
}
test('officetel bundles render identically to month files in both stages and are fetched once per page',async()=>{
 const root=mkdtempSync(join(tmpdir(),'housing-retention-'));try{
  const now=new Date(),ym=i=>{const d=new Date(now.getFullYear(),now.getMonth()-i,1);return`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}`;},months=Array.from({length:14},(_,i)=>ym(13-i));
  const rowsFor=m=>Array.from({length:Number(m.slice(4))%3},(_,i)=>({date:`${m.slice(0,4)}-${m.slice(4)}-0${i+1}`,area:24.5+i,category:i%2?'monthly':'jeonse',kind:'rent',deposit:100+i,monthlyRent:i?50:0,entityId:'off-'+i,name:'오피스텔'+i,dong:'동',jibun:'1',property:'officetel'}));
  const st=officetelStages(root,months,rowsFor,ym(11)),monthPath=m=>`data/contracts/officetel-rent/11110/${m}.json`;
  assert.deepEqual(Object.keys(st.stage1.retired),[]);assert.ok(st.stage1.manifest.partitions.every(p=>p.path&&p.bundle));
  assert.deepEqual(Object.keys(st.stage2.retired).sort(),months.filter(m=>m>=ym(11)).map(monthPath).sort());
  assert.deepEqual(Object.keys(st.stage2.state.bundled).sort(),months.map(monthPath).sort());
  assert.deepEqual(Object.keys(st.stage2.retained.superseded).sort(),months.filter(m=>m>=ym(11)).map(monthPath).sort());
  assert.ok(st.stage2.manifest.partitions.every(p=>p.path===null&&p.bundle));assert.equal([...st.stage2.files.keys()].some(p=>/\/\d{6}\.json$/.test(p)),false);
  assert.deepEqual(st.stage3.manifest,st.stage2.manifest,'stage 2 retains itself from its own bundles');assert.deepEqual([...st.stage3.files],[...st.stage2.files]);
  const years=[...new Set(months.filter(m=>m<ym(11)).map(m=>m.slice(0,4)))],views={};
  for(const[name,{manifest,files}]of Object.entries(st)){const page=await renderContracts(manifest,files);views[name]={recent:page.view,fetched:[...page.fetched],years:[]};for(const y of years)views[name].years.push(await page.period(y));views[name].all=page.fetched;}
  for(const name of ['stage1','stage2','stage3']){assert.deepEqual(views[name].recent,views.stage0.recent,name);assert.deepEqual(views[name].years,views.stage0.years,name);}
  assert.match(views.stage0.recent.status,/12개월 자료/);assert.equal(views.stage0.fetched.filter(u=>/\/\d{6}\.json$/.test(u)).length,12);
  for(const name of ['stage1','stage2']){
   assert.deepEqual(views[name].fetched.filter(u=>u.startsWith('/data/contracts/')&&u!=='/data/contracts/index.json'),['/data/contracts/officetel-rent/11110/recent.json'],name);
   const bundles=views[name].all.filter(u=>/\/(recent|\d{4})\.json$/.test(u));assert.equal(new Set(bundles).size,bundles.length,name+' fetches each bundle once');
  }
  // The page script before bundles reads the stage 1 month files and renders the same data.
  const oldScript=execFileSync('git',['show','fca6591a7:js/contracts.js'],{cwd:new URL('..',import.meta.url)}).toString();
  assert.deepEqual((await renderContracts(st.stage1.manifest,st.stage1.files,oldScript)).view,views.stage0.recent);
 }finally{const target=realpathSync(root),parent=realpathSync(tmpdir());if(!target.startsWith(parent+sep)||!target.slice(parent.length+1).startsWith('housing-retention-'))throw Error('Unsafe test cleanup');rmSync(target,{recursive:true,force:true});}
});
