/* Shared immutable data downloads for sale and rental maps. */
(function(root){
  'use strict';
  function create(name,limit=18){
    let opened;
    async function storage(){
      if(typeof caches==='undefined')return null;
      if(!opened)opened=caches.open(name).catch(()=>null);
      return opened;
    }
    async function download(path,expected,{signal,background=false,persist=true}={}){
      const url='/'+path+'?v='+expected,store=persist?await storage():null;
      const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
      signal?.throwIfAborted();
      if(store){
        const saved=await store.match(url).catch(()=>null);
        if(saved){
          let bytes;try{bytes=await saved.arrayBuffer();}catch{}
          signal?.throwIfAborted();
          if(bytes&&await digest(bytes)===expected)return bytes;
          await store.delete(url).catch(()=>{});
        }
      }
      const response=await fetch(url,{signal,priority:background?'low':'high'});
      if(!response.ok)throw Error('거래 자료를 불러오지 못했습니다. 다시 시도해 주세요.');
      const bytes=await response.arrayBuffer();signal?.throwIfAborted();
      if(await digest(bytes)!==expected)throw Error('자료가 업데이트되었습니다. 새로고침해 주세요.');
      signal?.throwIfAborted();
      if(store)try{await store.put(url,new Response(bytes));const keys=await store.keys();for(const key of keys.slice(0,Math.max(0,keys.length-limit)))await store.delete(key);}catch{}
      return bytes;
    }
    return {download};
  }
  root.NodoVerifiedDataCache={create};
})(globalThis);
