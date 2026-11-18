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
async function renderContracts(manifest,files,source=readFileSync(new URL('../js/contracts.js',import.meta.url),'utf8'),override=null){
 const elements=new Map(),fetched=[],node=()=>({value:'',textContent:'',children:[],options:[],disabled:false,selectedIndex:0,append(...c){this.children.push(...c);},replaceChildren(...c){this.children=c;this.options=c;},add(o){this.options.push(o);if(this.value==='')this.value=o.value;}});
 const $=id=>{if(!elements.has(id))elements.set(id,node());return elements.get(id);};$('period').value='recent';
 const text=e=>e.textContent+e.children.map(text).join('|');
 const context={URLSearchParams,window:{addEventListener(){}},document:{getElementById:$,createElement:node},location:{search:'?property=officetel&category=all-rent&lawd=11110'},sessionStorage:{getItem(){return null;},setItem(){}},performance:{getEntriesByType:()=>[]},Option:function(text,value){return{text,value};},
  NodoApartmentSearch:{bind:()=>({checkScope(){},reportCount(){},restore:async()=>{},clear(){}})},
  fetch:async url=>{fetched.push(url);const replaced=override?.(url);if(replaced)return{ok:true,json:async()=>replaced};if(url==='/data/contracts/index.json')return{ok:true,json:async()=>structuredClone(manifest)};const name=url.slice('/data/contracts/'.length);return files.has(name)?{ok:true,json:async()=>JSON.parse(files.get(name))}:{ok:false};}};
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
import{officetelState,officetelPartition,writeOfficetelBundles}from'./build-housing-details.mjs';
// Run the real generator helpers over consecutive nights. Each night has its own months and rows,
// so the stage 1 -> stage 2 transition sees added, changed, 0->n and new months.
function officetelNights(root,queryStartMonth,nights){
 const hash=b=>createHash('sha256').update(b).digest('hex'),write=(dir,p,b)=>{mkdirSync(dirname(join(dir,p)),{recursive:true});writeFileSync(join(dir,p),b);return hash(b);};
 const part=(m,rows)=>({service:'officetel-rent',lawd:'11110',month:m,count:rows.length,checkedAt:'2026-11-17T00:00:00Z',path:`officetel-rent/11110/${m}.json`});
 // The exporter writes floats such as 24.0; bundles must keep that text exactly.
 const monthFile=rows=>Buffer.from('{"rows":['+rows.map(r=>JSON.stringify(r).replace(/"area":(\d+)([,}])/,'"area":$1.0$2')).join(',')+']}');
 const plain=(night)=>{const manifest={schema:2,queryStartMonth,districts:{'11110':['서울','종로구']},sources:{},partitions:[]},files=new Map();for(const m of night.months){const rows=night.rowsFor(m),p=part(m,rows);manifest.partitions.push(p);files.set(p.path,monthFile(rows).toString());}return {manifest,files};};
 const first=plain(nights[0]),out=[{...first,night:nights[0]}];let previous=join(root,'night0');
 for(const[p,b]of first.files)first.manifest.sources['data/contracts/'+p]=write(previous,'data/contracts/'+p,b);write(previous,'data/contracts/index.json',JSON.stringify(first.manifest));
 nights.slice(1).forEach((night,i)=>{
  const dir=join(root,'night'+(i+1)),state=officetelState({monthFiles:night.monthFiles}),retired={},emitted=new Map(),manifest={schema:2,queryStartMonth,districts:first.manifest.districts,sources:{},partitions:[]},emit=(p,b)=>{emitted.set(p,b);manifest.sources[p]=hash(b);};
  const current=night.months.filter(m=>m>=queryStartMonth);
  for(const m of current){const b=monthFile(night.rowsFor(m));manifest.partitions.push(officetelPartition(part(m,night.rowsFor(m)),b,state,manifest.sources,retired));if(night.monthFiles)emitted.set('data/contracts/'+part(m,[]).path,b);}
  const retained=retainUnconvertedContracts(previous,manifest,emit,retired,state);writeOfficetelBundles(manifest,state,emit);
  for(const[p,b]of emitted)write(dir,p,b);write(dir,'data/contracts/index.json',JSON.stringify(manifest));
  out.push({manifest,files:new Map([...emitted].map(([p,b])=>[p.slice('data/contracts/'.length),b.toString()])),retired,state,retained,night,previous});previous=dir;
 });
 return {out,plain,monthFile};
}
test('officetel bundles follow changing months through stage 1, the stage 2 transition and later nights',async()=>{
 const root=mkdtempSync(join(tmpdir(),'housing-retention-'));try{
  const now=new Date(),ym=i=>{const d=new Date(now.getFullYear(),now.getMonth()-i,1);return`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}`;},start=ym(11);
  const row=(m,i,extra={})=>({area:24+i,category:i%2?'monthly':'jeonse',date:`${m.slice(0,4)}-${m.slice(4)}-0${i+1}`,deposit:100+i,dong:'동',entityId:'off-'+i,jibun:'1',kind:'rent',monthlyRent:i?50:0,name:'오피스텔'+i,property:'officetel',...extra});
  const base=m=>Array.from({length:Number(m.slice(4))%3},(_,i)=>row(m,i));
  const older=Array.from({length:13},(_,i)=>ym(13-i)),all=[...older,ym(0)];
  // Night 1 adds a row to ym(1); night 2 (stage 2 transition) changes a row in ym(2), fills an empty
  // month 0->n and adds the new month ym(0); night 3 adds another row while month files are gone.
  const emptyMonth=older.find(m=>m>=start&&!base(m).length);
  const v1=m=>m===ym(1)?[...base(m),row(m,4)]:base(m);
  const v2=m=>m===ym(2)?base(m).map((r,i)=>i?r:{...r,deposit:999}):m===emptyMonth?[row(m,5)]:m===ym(0)?[row(m,0)]:v1(m);
  const v3=m=>m===ym(0)?[row(m,0),row(m,1)]:v2(m);
  const {out,plain}=officetelNights(root,start,[{months:older,rowsFor:base},{months:older,rowsFor:v1,monthFiles:true},{months:all,rowsFor:v2,monthFiles:false},{months:all,rowsFor:v3,monthFiles:false}]);
  const[,s1,s2,s3]=out,monthPath=m=>`data/contracts/officetel-rent/11110/${m}.json`,committed=older.map(monthPath).sort();
  assert.ok(s1.manifest.partitions.every(p=>p.path&&p.bundle));assert.deepEqual(Object.keys(s1.retired),[]);
  assert.ok(s2.manifest.partitions.every(p=>p.path===null&&p.bundle));assert.equal([...s2.files.keys()].some(p=>/\/\d{6}\.json$/.test(p)),false);
  // Every committed month file is retired once: current ones superseded by the regenerated month, expired ones bundled as they were.
  assert.deepEqual(Object.keys(s2.state.bundled).filter(p=>committed.includes(p)).sort(),committed);assert.deepEqual(Object.keys(s2.retained.superseded).sort(),older.filter(m=>m>=start).map(monthPath).sort());
  // bundledContracts names the exact month bytes each bundle month reproduces.
  const bundleText=name=>s2.files.get(name),{officetelBundleMonths:split}=await import('./build-housing-details.mjs');
  for(const m of all){const months=split(Buffer.from(bundleText(m<start?`officetel-rent/11110/${m.slice(0,4)}.json`:'officetel-rent/11110/recent.json'))),bytes=Buffer.from('{"rows":'+months.get(m)+'}');assert.equal(createHash('sha256').update(bytes).digest('hex'),s2.state.bundled[monthPath(m)],m);assert.match(months.get(m),m===ym(0)?/"area":24\.0/:/^\[/);}
  for(const[i,s]of[[1,s1],[2,s2],[3,s3]]){
   const expected=plain(s.night),page=await renderContracts(s.manifest,s.files),baseline=await renderContracts(expected.manifest,expected.files);
   assert.deepEqual(page.view,baseline.view,'night '+i);assert.notDeepEqual(page.view,(await renderContracts(plain(out[i-1].night).manifest,plain(out[i-1].night).files)).view,'night '+i+' changed data');
   const years=[...new Set(older.filter(m=>m<start).map(m=>m.slice(0,4)))];for(const y of years)assert.deepEqual(await page.period(y),await baseline.period(y),'night '+i+' year '+y);
   const bundles=page.fetched.filter(u=>/\/(recent|\d{4})\.json$/.test(u));assert.equal(new Set(bundles).size,bundles.length,'night '+i+' fetches each bundle once');
  }
  assert.deepEqual((await renderContracts(s1.manifest,s1.files)).fetched.filter(u=>u.startsWith('/data/contracts/')&&u!=='/data/contracts/index.json'),['/data/contracts/officetel-rent/11110/recent.json']);
  // The page script before bundles reads the stage 1 month files and renders the same data.
  const oldScript=readFileSync(new URL('./fixtures/contracts-before-bundles.js',import.meta.url),'utf8');
  assert.deepEqual((await renderContracts(s1.manifest,s1.files,oldScript)).view,(await renderContracts(plain(s1.night).manifest,plain(s1.night).files)).view);
  // A bundle whose month count disagrees with the index is dropped, the index is read again and the page recovers.
  const stale=structuredClone(s3.manifest),target=stale.partitions.find(p=>p.month===ym(0));target.count=1;let reads=0;
  const recovered=await renderContracts(stale,s3.files,undefined,url=>url==='/data/contracts/index.json'&&reads++?structuredClone(s3.manifest):null);
  assert.deepEqual(recovered.view,(await renderContracts(s3.manifest,s3.files)).view);
 }finally{const target=realpathSync(root),parent=realpathSync(tmpdir());if(!target.startsWith(parent+sep)||!target.slice(parent.length+1).startsWith('housing-retention-'))throw Error('Unsafe test cleanup');rmSync(target,{recursive:true,force:true});}
});
test('officetel bundle months split back to their exact month texts',async()=>{
 const{officetelBundleMonths:split}=await import('./build-housing-details.mjs');
 const months=split(Buffer.from('{"schema":1,"months":{"202606":[{"a":"]}\\"[","b":38.0}],"202607":[]}}'));
 assert.deepEqual([...months],[['202606','[{"a":"]}\\"[","b":38.0}]'],['202607','[]']]);
 for(const bad of ['{"schema":1,"months":{"20260":[]}}','{"schema":1,"months":{"202606":[}}','{"schema":2,"months":{}}','{"schema":1,"months":{"202606":[]} }','{"schema":1,"months":{"202606":[],"202606":[]}}'])assert.throws(()=>split(Buffer.from(bad)),/framing|JSON/);
});
test('a stale or missing officetel bundle is downloaded once per load, not once per month',async()=>{
 const now=new Date(),ym=i=>{const d=new Date(now.getFullYear(),now.getMonth()-i,1);return`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}`;},months=Array.from({length:12},(_,i)=>ym(i));
 const row=m=>({date:`${m.slice(0,4)}-${m.slice(4)}-05`,area:24.5,category:'jeonse',kind:'rent',deposit:1,entityId:'o',name:'n',dong:'d',jibun:'1',property:'officetel'});
 const name='officetel-rent/11110/recent.json',files=new Map([[name,JSON.stringify({schema:1,months:Object.fromEntries(months.map(m=>[m,[row(m),row(m)]]))})]]);
 const index=count=>({schema:2,districts:{'11110':['서울','종로구']},partitions:months.map(m=>({service:'officetel-rent',lawd:'11110',month:m,count,checkedAt:'2026-11-17',path:null,bundle:name}))});
 const downloads=page=>page.fetched.filter(u=>u==='/data/contracts/'+name).length;
 // Every month disagrees with the index: one download, one index refresh, one more download.
 let reads=0;const refreshed=await renderContracts(index(1),files,undefined,url=>url==='/data/contracts/index.json'&&reads++?index(2):null);
 assert.equal(downloads(refreshed),2);assert.match(refreshed.view.status,/^12개월 자료/);
 const stale=await renderContracts(index(1),files);assert.equal(downloads(stale),2);assert.match(stale.view.status,/^0개월 자료/);
 assert.equal(stale.fetched.filter(u=>u==='/data/contracts/index.json').length,2);
 const missing=await renderContracts(index(2),new Map());assert.equal(downloads(missing),1);assert.match(missing.view.status,/^0개월 자료/);
 // The failed bundle is not kept: the next load of the page downloads it again.
 assert.equal(downloads({fetched:(await missing.period('recent'),missing.fetched)}),2);
});
