import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {gzipSync} from 'node:zlib';
import {sha} from './build-apartment-data.mjs';
import {createSplitFacts} from './current-review-split-facts.mjs';
import {packSaleYear} from './build-housing-sales.mjs';
import {packQuarter,encodeQuarter} from '../js/housing-quarter.mjs';
import {excludedSaleRows} from '../js/housing-sale-detail.mjs';
import * as codec from '../js/generated/housing-columns.mjs';

function fixture(){
  const root=mkdtempSync(join(tmpdir(),'current-review-split-'));
  const put=(path,value)=>{const bytes=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value));mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),bytes);return sha(bytes);};
  const specs=[{code:'11110',sources:['A','B','C','UNTOUCHED'],areas:[[0,'59.1'],[0,'59.4'],[0,'104.5'],[1,'59.2'],[1,'104.5'],[2,'59.3'],[3,'59.1']]},
    {code:'11140',sources:['D'],areas:[[0,'59.1']]},{code:'11170',sources:['E'],areas:[[0,'59.1']]}];
  const rows=[{i:0,as:'A',a:59,n:'one',g:'g',u:10,c:3,m:-4,s:5,k:6,lr:1.25,lc:false,fr:201},
    {i:1,as:'A',a:104,n:'one',g:'g',u:20,ls:2.5,lc:true},
    {i:8,as:'B',a:59,n:'two',g:'g',u:30,c:7,m:-8,s:9,k:10},
    {i:9,as:'B',a:104,n:'two',g:'g'},
    {i:10,as:'C',a:59,n:'gone',g:'g'},{i:11,as:'UNTOUCHED',a:59,n:'other',g:'g'},
    {i:12,as:'D',a:59,n:'district two',g:'h'},{i:13,as:'E',a:59,n:'district three',g:'i'}];
  put('data/index.json',{d:rows});
  const descriptor={schema:3,format:'packed-region',regions:{}},sources={},quarters={},states={};
  const table={areas:{},complexes:{}},facts=new Map(),saleGroups=new Map(),extras={};
  let serial=0;
  const add=(code,area,date,price,floor,flags=0,cancelled='',duplicate=null)=>{
    const id=duplicate??(++serial).toString(16).padStart(20,'0'),fact=[code+':'+area,date,price,floor,flags,null,null,null,null,0,id,null];
    if(!facts.has(code))facts.set(code,[]);facts.get(code).push(fact);
    const [complex,exact]=table.areas[code+':'+area],display=exact==='104.5'?104:59,year=String(date).slice(0,4),key=code+'/'+year;
    if(!saleGroups.has(key))saleGroups.set(key,new Map());
    const groupKey=complex+'|'+display,groups=saleGroups.get(key);
    if(!groups.has(groupKey))groups.set(groupKey,{complex,area:display,ts:[]});
    groups.get(groupKey).ts.push([Math.floor(date/100)%100,date%100,price,floor??0,flags,cancelled]);
    return id;
  };
  for(const spec of specs){
    const {code}=spec,identity={complexes:spec.sources,areas:spec.areas},metadata={complexes:spec.sources.map(id=>({id,r:1,n:id,hasSale:id!=='C',...(['A','B'].includes(id)?{publicId:'old-group',representativeKey:'11110:0'}:{})})),areas:[]};
    spec.identity=identity;
    descriptor.regions[code]={identities:`data/daily/regions/${code}/identities.json`,metadata:`data/daily/regions/${code}/metadata.json`};
    sources[descriptor.regions[code].identities]=put(descriptor.regions[code].identities,identity);
    sources[descriptor.regions[code].metadata]=put(descriptor.regions[code].metadata,metadata);
    spec.areas.forEach(([c,a],i)=>table.areas[code+':'+i]=[code+':'+c,a]);
    spec.sources.forEach((id,i)=>table.complexes[code+':'+i]=metadata.complexes[i]);
  }
  add('11110',0,20251201,12000,2);
  const duplicate=add('11110',0,20260901,10000,null);
  add('11110',0,20260901,10000,null,0,'',duplicate);
  add('11110',1,20260915,16000,3,1);
  add('11110',0,20261001,99999,5,2,'2026-10-05');
  add('11110',2,20260902,120000,8);
  add('11110',3,20260901,70000,7);
  add('11110',3,20261003,90000,10);
  add('11110',4,20261004,888888,20,3,'2026-10-09');
  const excludedId=add('11110',5,20260909,777777,1,4);
  facts.get('11110').pop();
  extras['11110']=codec.encodeColumns(codec.schemas.ExcludedSaleFact,[[5,20260909,777777n,0,1,4,excludedId,'disappeared_source_without_active_sale']]);
  add('11110',6,20261005,500000,25);
  add('11140',0,20260901,30000,9);
  add('11170',0,20260901,40000,10);
  const months=new Set();
  for(const spec of specs){
    const code=spec.code,grouped=new Map();quarters[code]={};states[code]={};
    for(const f of facts.get(code)){
      const text=String(f[1]),m=text.slice(0,4)+'-'+text.slice(4,6),q=text.slice(0,4)+'-Q'+Math.ceil(Number(text.slice(4,6))/3);
      months.add(m);if(!grouped.has(q))grouped.set(q,{});
      grouped.get(q)[m]??={daily:{rows:[],updates:[]},rental:{rows:[],updates:[]}};
      grouped.get(q)[m].daily.rows.push(f);
    }
    for(const[q,data]of grouped){
      const path=`data/daily/regions/${code}/quarters/${q}.bin`;
      sources[path]=put(path,gzipSync(encodeQuarter(packQuarter(code,q,data,spec.identity,codec))));
      for(const m of Object.keys(data)){quarters[code][m]=path;states[code][m]=null;}
    }
  }
  sources['data/daily/regions/index.json']=put('data/daily/regions/index.json',descriptor);
  put('data/daily/index.json',{schema:3,months:[...months].sort(),sources,regional:{format:'packed-region',kind:'daily',authority:'data/daily/regions/index.json',quarters,states}});
  const sales={schema:1,format:'sale-fact-references',regions:{},sources:{},facts:{...sources},excluded:{}};
  for(const[key,groups]of saleGroups){
    const[code,year]=key.split('/'),base=facts.get(code).filter(f=>String(f[1]).startsWith(year));
    const extra=extras[code]?excludedSaleRows(extras[code],table,codec,code).filter(f=>String(f[1]).startsWith(year)):[];
    const packed=packSaleYear([...groups.values()],base.concat(extra),table,code,year,new Set(base.map(f=>f[10])));
    const path=`data/sale-details/${code}/${year}.bin`;sales.regions[code]??={};sales.regions[code][year]=path;sales.sources[path]=put(path,packed.bytes);
  }
  for(const[code,bytes]of Object.entries(extras)){const path=`data/sale-details/${code}/excluded.bin`;sales.excluded[code]=path;sales.sources[path]=put(path,gzipSync(bytes));}
  put('data/sale-details/index.json',sales);
  return {root,rows,sales,put,close:()=>rmSync(root,{recursive:true,force:true})};
}

test('split sources recover their own statistics, display areas, metrics and comment IDs',()=>{
  const f=fixture();try{
    const {areasFor,metrics}=createSplitFacts(f.root),a=areasFor('A'),b=areasFor('B');
    assert.deepEqual(a.map(x=>x.area),[59,104]);
    assert.equal(a[0].total,4);assert.equal(a[0].latest.price,16000);assert.equal(a[0].latest.source,'A');
    assert.deepEqual(a[0].monthly['202609'],{average:12000,min:10000,max:16000,count:3});
    assert.deepEqual(a[0].recent,{value:12000,count:3,from:202609,to:202609});
    assert.equal(a[0].yearly['2025'].count,1);assert.equal(a[0].monthly['202610'],undefined);
    assert.equal(a[0].lastFive.filter(t=>t.price===10000).length,2);
    assert.equal(a[0].lastFive.find(t=>t.price===10000).floor,0);
    assert.equal(a[0].rows[0].i,0);assert.equal(a[0].rows[0].commentId,'apt_0');
    assert.equal(a[0].rows[0].source,'A');assert.equal(a[0].units,10);
    assert.deepEqual(a[0].rows[0].metrics,{cagr:3,mdd:-4,sharpe:5,momentum:6,land:1.25,landKind:'registry',landVerified:false,far:201});
    assert.equal(a[1].rows[0].metrics.land,2.5);assert.equal(a[1].rows[0].metrics.landKind,'estimate');
    assert.equal(a[1].latest.price,120000);assert.equal(a[1].latest.row,1);
    assert.equal(b[0].total,2);assert.equal(b[0].latest.price,90000);assert.equal(b[0].latest.row,8);
    assert.equal(b[0].rows[0].commentId,'apt_8');assert.equal(b[0].recent.value,80000);
    assert.equal(b[1].total,0);assert.equal(b[1].latest,null);assert.deepEqual(b[1].lastFive,[]);
    assert.equal(metrics.sourcesSummarized,2);assert.equal(metrics.factsSummarized,9);
    assert.equal(metrics.regionLoads,1);assert.equal(metrics.regionCacheHits,1);
    assert.deepEqual(metrics.regionsLoaded,['11110']);
    assert.equal(metrics.excludedRowsLoaded,1);assert.equal(metrics.referenceRowsLoaded,11);
    assert.equal(Object.hasOwn(a[0].latest,'identity'),false);
    assert.deepEqual(JSON.parse(readFileSync(join(f.root,'data/index.json'))).d,f.rows);
    const absent=areasFor('unknown');assert.deepEqual(absent,[]);assert.equal(metrics.regionLoads,1);
  }finally{f.close();}
});

test('disappeared-only sources remain empty; bounded region cache does not recompute requested sources',()=>{
  const f=fixture();try{
    const {areasFor,metrics}=createSplitFacts(f.root),a=areasFor('A');
    const gone=areasFor('C');assert.equal(gone[0].total,0);assert.equal(gone[0].latest,null);
    areasFor('D');areasFor('E');assert.equal(metrics.regionLoads,3);assert.equal(metrics.regionEvictions,1);
    a[0].rows[0].commentId='changed by caller';a[0].latest.price=-1;
    const again=areasFor('A');assert.equal(again[0].rows[0].commentId,'apt_0');assert.equal(again[0].latest.price,16000);
    assert.equal(metrics.regionLoads,3);assert.equal(metrics.sourceCacheHits,1);
    assert.equal(metrics.sourcesSummarized,4);assert.ok(metrics.peakRetainedEstimatedBytes<=256*1024*1024);
    assert.ok(metrics.decodeCache.peakRetainedEstimatedBytes<=64*1024*1024);
  }finally{f.close();}
});

test('missing packed sources and changed reference bytes fail without a silent empty summary',()=>{
  const f=fixture();try{
    const index=JSON.parse(readFileSync(join(f.root,'data/index.json')));index.d.push({i:99,as:'missing',a:59});f.put('data/index.json',index);
    assert.throws(()=>createSplitFacts(f.root).areasFor('missing'),/missing from packed identities/);
    writeFileSync(join(f.root,f.sales.regions['11110']['2026']),Buffer.from('changed'));
    assert.throws(()=>createSplitFacts(f.root).areasFor('A'),/sale source mismatch/);
  }finally{f.close();}
});

test('sale facts must match their daily manifest and baseline display rows must be unambiguous',()=>{
  const f=fixture();try{
    const index=JSON.parse(readFileSync(join(f.root,'data/index.json')));index.d.push({...index.d[0],i:98});f.put('data/index.json',index);
    assert.throws(()=>createSplitFacts(f.root).areasFor('A'),/Ambiguous split source display area/);
    f.sales.facts[Object.keys(f.sales.facts)[0]]='0'.repeat(64);f.put('data/sale-details/index.json',f.sales);
    assert.throws(()=>createSplitFacts(f.root).areasFor('A'),/sale\/shared data mismatch/);
  }finally{f.close();}
});
