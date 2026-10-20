/* Shared immutable data downloads for sale and rental maps. */
(function(root){
  'use strict';
  function create(name,limit=18,{maxBytes=Infinity}={}){
    let opened;
    async function storage(){
      if(typeof caches==='undefined')return null;
      if(!opened)opened=caches.open(name).catch(()=>null);
      return opened;
    }
    async function download(path,expected,{signal,background=false,persist=true,range=null}={}){
      if(range&&(!Number.isSafeInteger(range.offset)||range.offset<12||!Number.isSafeInteger(range.length)||range.length<2||!Number.isSafeInteger(range.total)||range.offset+range.length>range.total||!/^[a-f0-9]{64}$/.test(range.sha256)))throw Error('Invalid state section');
      const url='/'+path+'?v='+expected+(range?'&section='+range.offset+'-'+range.length+'-'+range.sha256:''),store=persist?await storage():null,contentHash=range?.sha256||expected;
      const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
      signal?.throwIfAborted();
      if(store){
        const saved=await store.match(url).catch(()=>null);
        if(saved){
          let bytes;try{bytes=await saved.arrayBuffer();}catch{}
          signal?.throwIfAborted();
          if(bytes&&await digest(bytes)===contentHash)return bytes;
          await store.delete(url).catch(()=>{});
        }
      }
      const response=await fetch(url,{signal,priority:background?'low':'high',...(range?{headers:{Range:`bytes=${range.offset}-${range.offset+range.length-1}`}}:{})});
      if(!response.ok)throw Error('거래 자료를 불러오지 못했습니다. 다시 시도해 주세요.');
      let bytes=await response.arrayBuffer();signal?.throwIfAborted();
      if(range){
        if(response.status===206){if(response.headers.get('Content-Range')!==`bytes ${range.offset}-${range.offset+range.length-1}/${range.total}`||bytes.byteLength!==range.length)throw Error('Invalid state range response');}
        else if(response.status===200){if(bytes.byteLength!==range.total||await digest(bytes)!==expected)throw Error('Invalid full state response');bytes=bytes.slice(range.offset,range.offset+range.length);}
        else throw Error('Invalid state response');
      }
      if(await digest(bytes)!==contentHash)throw Error('자료가 업데이트되었습니다. 새로고침해 주세요.');
      signal?.throwIfAborted();
      if(store&&bytes.byteLength<=maxBytes)try{await store.put(url,new Response(bytes,{headers:{'Content-Length':String(bytes.byteLength)}}));const keys=await store.keys();let retained=0,count=0;for(const key of keys.reverse()){const cached=Number.isFinite(maxBytes)?await store.match(key):null;const size=Number.isFinite(maxBytes)?Number(cached?.headers.get('Content-Length')||maxBytes+1):0;if(++count>limit||retained+size>maxBytes)await store.delete(key);else retained+=size;}}catch{}
      return bytes;
    }
    return {download};
  }
  async function decode(bytes,path){
    const input=new Uint8Array(bytes);if(new TextDecoder().decode(input.subarray(0,8))==='PGSTBND1')return input;
    const raw=path.endsWith('.bin')?new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()):new Uint8Array(bytes);
    const magic=new TextDecoder().decode(raw.subarray(0,8));
    if(magic==='PGHOUSE1'||magic==='PGSTATE1'||magic==='PGCOL001'||magic==='PGHIST01')return raw;
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  }
  root.NodoVerifiedDataCache={create,decode};
})(globalThis);
