/* Shared V-World configuration and parcel service. No cap on approved parcel members. */
(function(root) {
  const key = '460574E9-772A-35FE-B547-1D551354ACF6';
  const cache = new Map();
  let serial = 0;
  function jsonp(url) {
    return new Promise((resolve, reject) => {
      const callback = '__nodoMap' + (++serial), script = document.createElement('script');
      const cleanup = () => { clearTimeout(timer); script.remove(); delete root[callback]; };
      const timer = setTimeout(() => { cleanup(); reject(new Error('지도 응답 시간이 초과되었습니다.')); }, 8000);
      root[callback] = data => { cleanup(); resolve(data); };
      script.onerror = () => { cleanup(); reject(new Error('지도 경계를 불러오지 못했습니다.')); };
      script.src = url + '&callback=' + callback;
      document.head.appendChild(script);
    });
  }
  function parcel(pnu) {
    if (!/^\d{19}$/.test(pnu)) return Promise.reject(new Error('잘못된 필지 번호'));
    if (!cache.has(pnu)) {
      const params = new URLSearchParams({service:'data', version:'2.0', request:'GetFeature', format:'json',
        size:'100', page:'1', geometry:'true', attribute:'false', crs:'EPSG:4326', data:'LP_PA_CBND_BUBUN',
        key, domain:'https://nodostream.com', attrfilter:'pnu:=:'+pnu});
      cache.set(pnu, jsonp('https://api.vworld.kr/req/data?'+params).then(data => {
        const fc = data?.response?.result?.featureCollection;
        if (!fc?.features?.length) throw new Error('필지 경계가 없습니다.');
        return fc;
      }).catch(error => { cache.delete(pnu); throw error; }));
    }
    return cache.get(pnu);
  }
  root.NodoMapServices = {key, parcel, tileURL:'https://api.vworld.kr/req/wmts/1.0.0/'+key+'/Base/{z}/{y}/{x}.png'};
})(window);
