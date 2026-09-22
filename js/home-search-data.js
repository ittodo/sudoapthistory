(function(root){
  let pending;
  async function load(){
    if(!pending)pending=(async()=>{
      const response=await fetch('/data/search/latest-index.json',{cache:'no-cache'});if(!response.ok)throw Error('단지 가격 요약을 불러오지 못했습니다.');const m=await response.json();
      const paths=['41','11','28'].map(r=>'data/search/latest-'+r+'.bin');
      if(m.schema!==1||!m.inputs?.['data/index.json']||paths.some(p=>!/^[a-f0-9]{64}$/.test(m.sources?.[p]||'')))throw Error('단지 가격 요약 버전이 올바르지 않습니다.');
      const disk=root.NodoVerifiedDataCache.create('nodo-home-search-v1',6),parts=await Promise.all(paths.map(async p=>{const bytes=await disk.download(p,m.sources[p]);return JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text());}));
      if(parts.some(p=>p.schema!==1||!Array.isArray(p.apartments)||!Array.isArray(p.prices)))throw Error('단지 가격 요약 형식이 올바르지 않습니다.');
      return {manifest:m,apartments:parts.flatMap(p=>p.apartments),prices:parts.flatMap(p=>p.prices)};
    })().catch(e=>{pending=null;throw e;});return pending;
  }
  root.NodoHomeSearchData={load};
})(globalThis);
