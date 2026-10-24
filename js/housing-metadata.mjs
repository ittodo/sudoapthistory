import './verified-data-cache.js';

const sourcePath='data/housing-v3/index.json',manifestPath='data/housing-v3/transport.json';
const hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
let cache;
function validate(m){
 if(m?.schema!==1||m.format!=='gzip-json-v1'||m.source?.path!==sourcePath||!/^[a-f0-9]{64}$/.test(m.source?.sha256||'')||m.file?.path!==`data/housing-v3/index.${m.source.sha256}.bin`||!/^[a-f0-9]{64}$/.test(m.file?.sha256||'')||!Number.isSafeInteger(m.source.bytes)||m.source.bytes<1||m.source.bytes>128*1024*1024||!Number.isSafeInteger(m.file.bytes)||m.file.bytes<1||m.file.bytes>25*1024*1024)throw Error('공동주택 전송 목록 형식이 올바르지 않습니다.');
 return m;
}
export async function decodeHousingMetadata(manifest,packed){
 const m=validate(manifest),bytes=new Uint8Array(packed);
 if(bytes.byteLength!==m.file.bytes||await hash(bytes)!==m.file.sha256)throw Error('공동주택 압축 자료가 전송 목록과 일치하지 않습니다.');
 const reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader(),parts=[];let length=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>m.source.bytes)throw Error('공동주택 원문 크기가 전송 목록과 일치하지 않습니다.');parts.push(value);}}
 catch(error){await reader.cancel().catch(()=>{});throw error;}
 finally{reader.releaseLock();}
 if(length!==m.source.bytes)throw Error('공동주택 원문 크기가 전송 목록과 일치하지 않습니다.');
 const raw=new Uint8Array(length);let offset=0;for(const part of parts){raw.set(part,offset);offset+=part.byteLength;}
 if(await hash(raw)!==m.source.sha256)throw Error('공동주택 원문 해시가 전송 목록과 일치하지 않습니다.');
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
}
export async function loadHousingMetadata({fetcher=globalThis.fetch,download}={}){
 const response=await fetcher('/'+manifestPath,{cache:'no-cache'});
 if(response.status===404){
  const old=await fetcher('/'+sourcePath,{cache:'no-cache'});if(!old.ok)throw Error(`데이터 응답 ${old.status}`);return old.json();
 }
 if(!response.ok)throw Error(`데이터 응답 ${response.status}`);
 const manifest=validate(await response.json());
 if(!download){cache??=globalThis.NodoVerifiedDataCache.create('nodostream-housing-metadata-v1',2,{maxBytes:32*1024*1024});download=(path,expected)=>cache.download(path,expected);}
 return decodeHousingMetadata(manifest,await download(manifest.file.path,manifest.file.sha256));
}
