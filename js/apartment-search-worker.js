import {createIndex,search} from './apartment-search-model.js';
let index,loading;
async function prepare(version) {
  if(index)return index;
  if(!loading)loading=(async()=>{
    const response=await fetch('/data/search/apartments.json?v='+encodeURIComponent(version||'local'));
    if(!response.ok)throw Error('자동완성 자료를 불러오지 못했습니다.');
    const data=await response.json(),started=performance.now();index=createIndex(data);
    return Object.assign(index,{version:data.version,prepareMs:performance.now()-started});
  })().catch(error=>{loading=null;throw error;});
  return loading;
}
self.onmessage=async({data})=>{
  try{const index=await prepare(data.version),started=performance.now();
    const result=data.action==='lookup' ? index.byId.get(data.key)||null : data.action==='search' ? search(index,data.query,data.scope) : null;
    self.postMessage({id:data.id,result,ms:performance.now()-started,prepareMs:index.prepareMs,version:index.version});
  }catch(error){self.postMessage({id:data.id,error:error.message});}
};
