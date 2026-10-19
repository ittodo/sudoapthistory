// Rebuild only a requested source's DTO summaries from existing packed facts.
import {readFileSync,realpathSync} from 'node:fs';
import {resolve,relative,isAbsolute,sep} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {regionalReader} from './regional-reader.mjs';
import {createHousingDecodeCache} from './housing-regional-reader.mjs';
import {sha,summarize} from './build-apartment-data.mjs';
import {restoreSaleReferences,excludedSaleRows} from '../js/housing-sale-detail.mjs';
import * as codec from '../js/generated/housing-columns.mjs';

const REGION_LIMIT=2,REGION_BYTES=256*1024*1024,ROW_BYTES=384;
const inside=(root,path)=>{const r=relative(root,path);return r!==''&&!r.startsWith('..'+sep)&&r!=='..'&&!isAbsolute(r);};

export function createSplitFacts(baseline){
  baseline=realpathSync(baseline);
  const read=name=>{
    const path=realpathSync(resolve(baseline,name));
    if(!inside(baseline,path))throw Error('Split fact path escapes baseline');
    return readFileSync(path);
  };
  const index=JSON.parse(read('data/index.json')),bySource=new Map(),results=new Map(),regions=new Map();
  for(const row of index.d){
    if(!bySource.has(row.as))bySource.set(row.as,[]);
    bySource.get(row.as).push(row);
  }
  const decodeCache=createHousingDecodeCache({maxBytes:64*1024*1024,maxEntries:4});
  const metrics={calls:0,sourcesSummarized:0,areasSummarized:0,factsSummarized:0,sourceCacheHits:0,
    regionsLoaded:[],regionLoads:0,regionCacheHits:0,regionEvictions:0,oversizedRegions:0,
    yearsLoaded:0,monthsLoaded:0,dailyRowsLoaded:0,excludedRowsLoaded:0,referenceRowsLoaded:0,
    retainedEstimatedBytes:0,peakRetainedEstimatedBytes:0,decodeCache:decodeCache.stats};
  let daily,sales;
  function initialize(){
    if(daily)return;
    const next=regionalReader(baseline,'daily',{verifyOnce:true,decodeCache});
    if(next.manifest.schema!==3)throw Error('Packed daily facts are required for source splitting');
    const manifest=JSON.parse(read('data/sale-details/index.json'));
    if(manifest.schema!==1||manifest.format!=='sale-fact-references'||!manifest.facts||!manifest.sources)throw Error('Invalid split sale reference index');
    for(const[path,hash]of Object.entries(manifest.facts))if(next.manifest.sources[path]!==hash)throw Error('Split sale/shared data mismatch: '+path);
    daily=next;sales=manifest;
  }
  function saleBytes(path){
    if(!/^data\/sale-details\/\d{5}\/(?:\d{4}|excluded)\.bin$/.test(path))throw Error('Invalid split sale path');
    const bytes=read(path);
    if(sha(bytes)!==sales.sources[path])throw Error('Split sale source mismatch: '+path);
    return new Uint8Array(gunzipSync(bytes));
  }
  function regionRows(code){
    if(regions.has(code)){
      const hit=regions.get(code);regions.delete(code);regions.set(code,hit);metrics.regionCacheHits++;
      return hit.groups;
    }
    const groups=new Map();let count=0;
    const extraPath=sales.excluded?.[code];
    if(extraPath&&extraPath!==`data/sale-details/${code}/excluded.bin`)throw Error('Invalid split excluded sale scope');
    const extra=extraPath?excludedSaleRows(saleBytes(extraPath),daily.table,codec,code):[];
    metrics.excludedRowsLoaded+=extra.length;
    for(const[year,path]of Object.entries(sales.regions[code]||{}).sort()){
      if(!/^\d{4}$/.test(year)||path!==`data/sale-details/${code}/${year}.bin`)throw Error('Invalid split sale year');
      const facts=[];
      for(const month of daily.manifest.months.filter(m=>m.startsWith(year+'-'))){
        const rows=daily.regionMonth(code,month,false).rows;
        for(const row of rows)facts.push(row);
        metrics.monthsLoaded++;metrics.dailyRowsLoaded+=rows.length;
      }
      for(const row of extra)if(String(row[1]).startsWith(year))facts.push(row);
      const restored=restoreSaleReferences(saleBytes(path),facts,daily.table,codec,code);
      for(const[key,rows]of restored){
        if(rows.some(r=>!String(r.date).startsWith(year)))throw Error('Split sale reference year mismatch');
        if(!groups.has(key))groups.set(key,[]);
        for(const row of rows)groups.get(key).push(row);
        count+=rows.length;
      }
      metrics.yearsLoaded++;
    }
    metrics.regionLoads++;metrics.referenceRowsLoaded+=count;
    if(!metrics.regionsLoaded.includes(code))metrics.regionsLoaded.push(code);
    const cost=Math.max(1,count)*ROW_BYTES+groups.size*128;
    // Call sources from the same district together to reuse its restored rows.
    // Only areasFor computes statistics; unrelated sources are never summarized.
    if(cost<=REGION_BYTES){
      while(regions.size&&(regions.size>=REGION_LIMIT||metrics.retainedEstimatedBytes+cost>REGION_BYTES)){
        const first=regions.keys().next().value;
        metrics.retainedEstimatedBytes-=regions.get(first).cost;regions.delete(first);metrics.regionEvictions++;
      }
      regions.set(code,{groups,cost});metrics.retainedEstimatedBytes+=cost;
      metrics.peakRetainedEstimatedBytes=Math.max(metrics.peakRetainedEstimatedBytes,metrics.retainedEstimatedBytes);
    }else metrics.oversizedRegions++;
    return groups;
  }
  function areasFor(source){
    metrics.calls++;
    if(typeof source!=='string'||!source)throw Error('A source aptSeq is required');
    if(results.has(source)){metrics.sourceCacheHits++;return structuredClone(results.get(source));}
    const rows=bySource.get(source);
    if(!rows)return [];
    initialize();
    const key=daily.table.source.get(source);
    if(!key)throw Error('Split source is missing from packed identities: '+source);
    const [code,local]=key.split(':'),seenAreas=new Set();
    for(const row of rows){
      if(!Number.isFinite(row.a)||row.i==null)throw Error('Invalid split source index row: '+source);
      if(seenAreas.has(row.a))throw Error('Ambiguous split source display area: '+source+'/'+row.a);
      seenAreas.add(row.a);
    }
    const grouped=regionRows(code);
    const areas=rows.slice().sort((a,b)=>a.a-b.a).map(row=>{
      const trades=(grouped.get(local+'|'+row.a)||[]).map(t=>({date:t.date,price:t.price,floor:t.floor,
        flags:t.flags,cancelled:t.cancelled,row:row.i,source:row.as,name:row.n,order:t.order}));
      metrics.factsSummarized+=trades.length;
      return {area:row.a,units:row.u??null,rows:[{i:row.i,source:row.as,name:row.n,district:row.g,units:row.u??null,
        metrics:{cagr:row.c,mdd:row.m,sharpe:row.s,momentum:row.k,land:row.lr||row.ls||null,
          landKind:row.lr?'registry':'estimate',landVerified:row.lc??null,far:row.fr??null},commentId:'apt_'+row.i}],
        ...summarize(trades)};
    });
    metrics.sourcesSummarized++;metrics.areasSummarized+=areas.length;
    results.set(source,areas);
    return structuredClone(areas);
  }
  return {areasFor,metrics};
}
