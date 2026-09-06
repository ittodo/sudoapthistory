// nodostream — 공유 데이터 로더
// 데이터 fetch 함수들. PRICES/VOLUMES/DETAILS/GEO_DATA 전역에 데이터 할당.
// window.APT_BASE가 설정되어 있으면 그 prefix로 fetch 경로를 보정 (예: /compare/ 페이지에서는 '../').

(function(){
  function _base(){ return (typeof window!=='undefined' && window.APT_BASE) || ''; }

  window.loadMonthly = async function(gu){
    if(MONTHLY_CACHE[gu]) return MONTHLY_CACHE[gu];
    try{
      const r=await fetch(_base()+'data/monthly/'+encodeURIComponent(gu)+'.json');
      const j=await r.json();
      MONTHLY_CACHE[gu]=j;
      return j;
    }catch(e){ console.warn('Monthly load failed for',gu,e); return {}; }
  };

  window.loadPrices = async function(){
    try{
      const r=await fetch(_base()+'data/prices.json'); PRICES=await r.json(); console.log('Prices loaded');
      if(typeof areaCache!=='undefined') areaCache={};
      if(typeof renderAreaList==='function' && typeof document!=='undefined' && document.getElementById('areaChecklist')) renderAreaList();
      if(typeof renderComparison==='function' && typeof selectedAreas!=='undefined' && selectedAreas.length) renderComparison();
    }
    catch(e){ console.warn('Price load failed',e); }
  };

  window.loadVolumes = async function(){
    try{ const r=await fetch(_base()+'data/volumes.json'); VOLUMES=await r.json(); console.log('Volumes loaded'); }
    catch(e){ console.warn('Volumes load failed',e); }
  };

  window.loadDetails = async function(){
    try{ const r=await fetch(_base()+'data/details.json'); DETAILS=await r.json(); console.log('Details loaded'); }
    catch(e){ console.warn('Details load failed',e); }
  };

  window.loadGeo = async function(){
    try{ const r=await fetch(_base()+'data/geo.json'); GEO_DATA=await r.json(); console.log('Geo loaded'); }
    catch(e){ console.warn('Geo load failed',e); }
  };

  window.loadParcels = async function(){
    if(PARCEL_DATA) return PARCEL_DATA;
    if(typeof PARCEL_PROMISE!=='undefined' && PARCEL_PROMISE) return PARCEL_PROMISE;
    const version=(typeof window!=='undefined'&&window.APT_ASSET_VERSION)||'';
    const suffix=version?'?v='+encodeURIComponent(version):'';
    PARCEL_PROMISE=fetch(_base()+'data/parcels.json'+suffix)
      .then(r=>{ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); })
      .then(j=>{
        const indexRows=Array.isArray(D)?D.length:null;
        const parcelRows=Number(j&&j.meta&&j.meta.indexRows);
        if(indexRows!==null&&parcelRows!==indexRows){
          throw new Error('index row mismatch: '+parcelRows+' != '+indexRows);
        }
        PARCEL_DATA=j; console.log('Parcels loaded'); return j;
      })
      .catch(e=>{ PARCEL_PROMISE=null; console.warn('Parcel load failed',e); return null; });
    return PARCEL_PROMISE;
  };

  window.loadTx = async function(gu){
    if(TX_CACHE[gu]) return TX_CACHE[gu];
    try{
      const r=await fetch(_base()+'data/tx/'+encodeURIComponent(gu)+'.json');
      const j=await r.json();
      TX_CACHE[gu]=j.entries||{};
      return TX_CACHE[gu];
    }catch(e){ console.warn('TX load failed for',gu,e); return {}; }
  };
})();
