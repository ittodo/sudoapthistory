import os from 'node:os';
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {resolve} from 'node:path';
import {searchData} from './build-search-data.mjs';
import {createIndex,search} from '../js/apartment-search-model.js';

if(isMainThread){
  const bytes=searchData(resolve(import.meta.dirname,'..'));
  const worker=new Worker(new URL(import.meta.url),{workerData:bytes.toString()});
  worker.on('message',result=>console.log(JSON.stringify({date:new Date().toISOString(),environment:{os:os.platform()+' '+os.release(),cpu:os.cpus()[0].model,node:process.version,logicalCores:os.cpus().length},bytes:bytes.length,...result},null,2)));
  worker.on('error',error=>{console.error(error);process.exitCode=1;});
}else{
  global.gc?.();const before=process.memoryUsage().heapUsed,started=performance.now(),data=JSON.parse(workerData),index=createIndex(data),prepared=performance.now()-started;
  global.gc?.();const heap=process.memoryUsage().heapUsed-before;
  const queries=['리센츠','리 센 츠','ㄹㅅㅊ','리ㅅㅊ','리센ㅊ','리센트','잠실 리센츠','잠실엘스','래미안 1단지','삼성','현대','반포자이','강남구 래미안','없는단지이름'];
  const timings=[];
  for(const query of queries)search(index,query);
  for(let round=0;round<8;round++)for(const query of queries){const started=performance.now();search(index,query);timings.push({query,ms:performance.now()-started});}
  const sorted=timings.map(t=>t.ms).sort((a,b)=>a-b);
  parentPort.postMessage({count:data.apartments.length,prepareMs:prepared,heapMiB:heap/1048576,samples:timings.length,p50Ms:sorted[Math.floor(sorted.length*.5)],p95Ms:sorted[Math.floor(sorted.length*.95)],maxMs:sorted.at(-1),slowest:timings.sort((a,b)=>b.ms-a.ms).slice(0,3),note:'Node worker: warm search only, excludes 150ms debounce, network and DOM paint. Browser/mobile measurements are recorded separately.'});
}
