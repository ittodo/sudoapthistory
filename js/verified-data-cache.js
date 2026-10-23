/* Shared immutable data downloads for sale and rental maps. */
(function(root){
  'use strict';
  const inFlight=new Map(),writes=new Map(),sizes=new Map(),pendingWrites=new Map(),DEFAULT_BYTES=64*1024*1024;
  function publicPath(path){return typeof path==='string'&&path.startsWith('data/')&&!/[?\\#%\u0000-\u001f]/.test(path)&&path.split('/').every(part=>part&&part!=='.'&&part!=='..');}
  async function writeLocked(name,work){
    const previous=writes.get(name)||Promise.resolve(),next=previous.catch(()=>{}).then(()=>root.navigator?.locks?.request?root.navigator.locks.request('nodo-file-cache:'+name,work):work());
    writes.set(name,next);try{return await next;}finally{if(writes.get(name)===next)writes.delete(name);}
  }
  const storageKey=key=>(typeof key==='string'?key:key.url).replace(/^https?:\/\/[^/]+/,'');
  async function trim(store,name,limit,maxBytes,url,bytes){
    let known=sizes.get(name);if(!known){known=new Map();sizes.set(name,known);}
    known.set(storageKey(url),bytes);
    const keys=await store.keys(),present=new Set(keys.map(storageKey));
    for(const key of known.keys())if(!present.has(key))known.delete(key);
    let retained=0,count=0;
    for(const key of keys.reverse()){
      const id=storageKey(key);let size=known.get(id);
      // Other tabs can add keys under the same lock. Read only unseen sizes.
      if(size===undefined){const response=await store.match(key);size=Number(response?.headers.get('Content-Length')??NaN);known.set(id,size);}
      if(!Number.isSafeInteger(size)||size<0||count>=limit||retained+size>maxBytes){await store.delete(key);known.delete(id);}
      else{retained+=size;count++;}
    }
  }
  function persist(store,name,limit,maxBytes,url,bytes,signal){
    if(!store||!limit||bytes.byteLength>maxBytes)return;
    let queue=pendingWrites.get(name);if(!queue){queue={entries:new Map(),bytes:0};pendingWrites.set(name,queue);}
    // A slow or blocked cache must not retain an unbounded queue of file buffers.
    if(queue.entries.has(url)||queue.entries.size>=limit||queue.bytes+bytes.byteLength>maxBytes)return;
    const copy=new Uint8Array(bytes).slice().buffer;
    queue.entries.set(url,copy);queue.bytes+=copy.byteLength;
    const done=()=>{queue.entries.delete(url);queue.bytes-=copy.byteLength;if(!queue.entries.size&&pendingWrites.get(name)===queue)pendingWrites.delete(name);};
    void writeLocked(name,async()=>{
      signal.throwIfAborted();await store.put(url,new Response(copy,{headers:{'Content-Length':String(copy.byteLength)}}));
      await trim(store,name,limit,maxBytes,url,copy.byteLength);
    }).then(done,done);
  }
  function subscribe(entry,signal){
    return new Promise((resolve,reject)=>{
      const listener={resolve,reject,signal,abort:null};
      listener.abort=()=>{
        entry.listeners.delete(listener);signal.removeEventListener('abort',listener.abort);reject(signal.reason);
        if(!entry.listeners.size&&!entry.settled){if(inFlight.get(entry.key)===entry)inFlight.delete(entry.key);entry.controller.abort();}
      };
      entry.listeners.add(listener);signal?.addEventListener('abort',listener.abort,{once:true});
      if(signal?.aborted)listener.abort();
    });
  }
  function settle(entry,error,bytes){
    entry.settled=true;if(inFlight.get(entry.key)===entry)inFlight.delete(entry.key);
    for(const listener of entry.listeners){listener.signal?.removeEventListener('abort',listener.abort);error?listener.reject(error):listener.resolve(bytes);}
    entry.listeners.clear();
  }
  function create(name,limit=18,{maxBytes=DEFAULT_BYTES}={}){
    if(typeof name!=='string'||!name||!Number.isSafeInteger(limit)||limit<0||!Number.isSafeInteger(maxBytes)||maxBytes<0)throw Error('Invalid public cache budget');
    let opened;
    async function storage(){
      if(typeof caches==='undefined')return null;
      if(!opened)opened=caches.open(name).catch(()=>null);
      return opened;
    }
    async function read(path,expected,range,entry){
      const {url,controller}=entry,signal=controller.signal,contentHash=range?.sha256||expected;
      signal.throwIfAborted();
      const pending=pendingWrites.get(name)?.entries.get(url);
      if(pending)return pending.slice(0); // Private copy was already hash-verified.
      let store=entry.persist?await storage():null;
      const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
      signal.throwIfAborted();
      if(store){
        const saved=await store.match(url).catch(()=>null);
        if(saved){
          let bytes;try{bytes=await saved.arrayBuffer();}catch{}
          signal.throwIfAborted();
          if(bytes&&(!range||bytes.byteLength===range.length)&&await digest(bytes)===contentHash){
            if(bytes.byteLength>maxBytes||!limit)await store.delete(url).catch(()=>{});
            return bytes;
          }
          await store.delete(url).catch(()=>{});
        }
      }
      const response=await fetch(url,{signal,credentials:'omit',priority:entry.background?'low':'high',...(range?{headers:{Range:`bytes=${range.offset}-${range.offset+range.length-1}`}}:{})});
      if(!response.ok)throw Error('거래 자료를 불러오지 못했습니다. 다시 시도해 주세요.');
      let bytes=await response.arrayBuffer();signal.throwIfAborted();
      if(range){
        if(response.status===206){if(response.headers.get('Content-Range')!==`bytes ${range.offset}-${range.offset+range.length-1}/${range.total}`||bytes.byteLength!==range.length)throw Error('Invalid state range response');}
        else if(response.status===200){if(bytes.byteLength!==range.total||await digest(bytes)!==expected)throw Error('Invalid full state response');bytes=bytes.slice(range.offset,range.offset+range.length);}
        else throw Error('Invalid state response');
      }
      if(await digest(bytes)!==contentHash)throw Error('자료가 업데이트되었습니다. 새로고침해 주세요.');
      signal.throwIfAborted();
      persist(store,name,limit,maxBytes,url,bytes,signal);
      signal.throwIfAborted();return bytes;
    }
    async function download(path,expected,{signal,background=false,persist=true,range=null}={}){
      if(!publicPath(path)||!/^[a-f0-9]{64}$/.test(expected))throw Error('Invalid public file reference');
      if(range&&(!Number.isSafeInteger(range.offset)||range.offset<12||!Number.isSafeInteger(range.length)||range.length<2||!Number.isSafeInteger(range.total)||range.offset+range.length>range.total||!/^[a-f0-9]{64}$/.test(range.sha256)))throw Error('Invalid state section');
      signal?.throwIfAborted();
      const url='/'+path+'?v='+expected+(range?'&section='+range.offset+'-'+range.length+'-'+range.sha256:''),key=JSON.stringify([name,limit,maxBytes,url,persist,range?.total]);
      let entry=inFlight.get(key);
      if(!entry){
        entry={key,url,controller:new AbortController(),listeners:new Set(),settled:false,persist,background};inFlight.set(key,entry);
        Promise.resolve().then(()=>read(path,expected,range,entry)).then(bytes=>settle(entry,null,bytes),error=>settle(entry,error));
      }else{entry.persist ||= persist;entry.background &&= background;}
      return subscribe(entry,signal);
    }
    return {download};
  }
  async function decode(bytes,path){
    const input=new Uint8Array(bytes);if(new TextDecoder().decode(input.subarray(0,8))==='PGSTBND1')return input;
    const raw=path.endsWith('.bin')?new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()):new Uint8Array(bytes);
    const magic=new TextDecoder().decode(raw.subarray(0,8));
    if(magic==='PGHOUSE1'||magic==='PGSTATE1'||magic==='PGCOL001'||magic==='PGHIST01'||magic==='PGRCD001')return raw;
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  }
  root.NodoVerifiedDataCache={create,decode,createHousing:()=>create('nodo-housing-files-v1',256,{maxBytes:DEFAULT_BYTES})};
})(globalThis);
