const entries=new Map();
export async function apartmentEntry(key){
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key)),bucket=(new Uint8Array(digest)[0]&63).toString(16).padStart(2,'0');
 if(!entries.has(bucket)){
  const promise=(async()=>{const r=await fetch('/data/apartments/entry/'+bucket+'.json',{cache:'no-cache'});if(!r.ok){const e=Error('단지 조회 자료를 불러오지 못했습니다.');e.status=r.status;throw e;}const value=await r.json();if(value.schema!==2||!value.lookup||!value.routes||!value.basis)throw Error('잘못된 단지 조회 자료입니다.');return value;})();
  entries.set(bucket,promise);while(entries.size>16)entries.delete(entries.keys().next().value);promise.catch(()=>entries.delete(bucket));
 }
 return entries.get(bucket);
}
