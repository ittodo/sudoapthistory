/* Region totals never depend on the viewport or on the apartment detail selection. */
(function(root) {
  'use strict';
  function create({map, payload, client, tap, navigate, report}) {
    const model = root.NodoMapModel, meta = payload.admin;
    const regions = new Map(meta.regions.map(r => [r.id, r]));
    let groups = new Map(), summaries = new Map(), filterRegion = null, token = 0;
    const cache = new Map(), loading = new Map();
    map.createPane('regions'); map.getPane('regions').style.zIndex = '350';
    const polygons = L.layerGroup().addTo(map), labels = L.layerGroup().addTo(map), leaders = L.layerGroup().addTo(map);
    const container = map.getContainer();
    const escape = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    function activate(region, event) {
      if (!model.regionClickable(map.getZoom())) return;
      const e = event.originalEvent;
      const focus = e?.target.closest?.('.region-marker') ? region.coord : event.latlng;
      if (e?.type === 'keydown' && (e.key === 'Enter' || e.key === ' ')) navigate(region,focus);
      else if (e && tap.accept('region:'+region.id, e.timeStamp)) navigate(region,focus);
    }
    function bindLayer(layer, region) {
      layer.on('click', e => activate(region,e));
      layer.on('keydown', e => {
        if (!e.originalEvent.repeat && ['Enter',' '].includes(e.originalEvent.key)) {
          L.DomEvent.stop(e.originalEvent);
          activate(region,e);
        }
      });
      const element = layer.getElement();
      if (element) {element.dataset.regionId = region.id; element.dataset.mapTarget = 'region:'+region.id;}
    }
    function describe(region) {
      const summary = summaries.get(region.id) || {average:null,count:0,pricedCount:0};
      const average = summary.average == null ? '가격 없음' : `평균 ${(summary.average/10000).toLocaleString('ko-KR',{minimumFractionDigits:1,maximumFractionDigits:1})}억`;
      return {summary,average,title:`${region.fullName} · ${average} · ${summary.count.toLocaleString()}개 단지 · 가격이 있는 ${summary.pricedCount.toLocaleString()}개 단지의 최신 실거래 산술평균 · 필터 반영 · 경계 ${meta.year}년 기준 · 짧게 눌러 전체 범위 보기`};
    }
    function fetchShard(path) {
      if (!loading.has(path)) loading.set(path, client(path).then(data => {
        if (data.year !== meta.year) throw new Error('경계 데이터가 업데이트되었습니다. 새로고침해 주세요.');
        cache.set(path, data);
      }).finally(() => loading.delete(path)));
      return loading.get(path);
    }
    function draw() {
      const zoom = map.getZoom(), mode = model.regionLevel(zoom), level = mode === 'apartment' ? 'dong' : mode;
      map.getPane('regions').classList.toggle('regions-disabled',!model.regionClickable(zoom));
      const bounds = map.getBounds().pad(.1);
      const visible = [...regions.values()].filter(r => r.level === level &&
        (filterRegion == null || r.id.startsWith(['31','11','23'][filterRegion])) && L.latLngBounds(r.bounds).intersects(bounds));
      polygons.clearLayers(); labels.clearLayers(); leaders.clearLayers();
      const paths = [...new Set(visible.map(r => r.shard))];
      const wanted = new Set(visible.map(r => r.id));
      for (const path of paths) if (cache.has(path)) {
        L.geoJSON(cache.get(path), {pane:'regions', bubblingMouseEvents:false, interactive:model.regionClickable(zoom),
          filter:f => wanted.has(f.properties.id),
          style:{color:'#416687',weight:mode === 'apartment' ? .8 : 1.3,opacity:.75,fillColor:'#60a5fa',fillOpacity:.025},
          onEachFeature(f,layer) {
            const region = regions.get(f.properties.id);
            const info = describe(region);
            layer.bindTooltip(`${escape(region.fullName)}<br>${info.average} · ${info.summary.count.toLocaleString()}개 단지`,{sticky:true,direction:'top'});
            layer.on('add', () => bindLayer(layer,region));
            layer.on('mouseover', () => layer.setStyle({weight:2,fillOpacity:.09}));
            layer.on('mouseout', () => layer.setStyle({weight:mode === 'apartment' ? .8 : 1.3,fillOpacity:.025}));
          }
        }).addTo(polygons);
      }
      if (mode !== 'apartment') {
        const occupied = [];
        const mapRect = container.getBoundingClientRect();
        const reserved = [...document.querySelectorAll('.region-status,.map-actions,.map-status,.leaflet-control-zoom,.detail:not([hidden])')]
          .map(el=>el.getBoundingClientRect()).filter(r=>r.width && r.height)
          .map(r=>({left:r.left-mapRect.left,top:r.top-mapRect.top,right:r.right-mapRect.left,bottom:r.bottom-mapRect.top}));
        // Stable priority and a small label offset; membership and the anchor never change.
        for (const r of visible.filter(r => summaries.has(r.id)).sort((a,b)=>summaries.get(b.id).count-summaries.get(a.id).count || a.id.localeCompare(b.id))) {
          const anchor = map.latLngToContainerPoint(r.coord), size = map.getSize();
          if (anchor.x < -65 || anchor.x > size.x+65 || anchor.y < -40 || anchor.y > size.y+40) continue;
          let point = null;
          const offsets = [[0,0],[0,-38],[0,38],[-62,0],[62,0],[-62,-38],[62,-38],[-62,38],[62,38]];
          if (mode === 'sido') offsets.push([0,-78],[0,78],[-124,-78],[124,-78],[-124,78],[124,78],[0,-150],[0,150]);
          for (const [dx,dy] of offsets) {
            const candidate = L.point(anchor.x+dx,anchor.y+dy);
            if (candidate.x < 60 || candidate.x > size.x-60 || candidate.y < 38 || candidate.y > size.y-38) continue;
            if (reserved.some(r=>candidate.x+62>r.left && candidate.x-62<r.right && candidate.y+36>r.top && candidate.y-36<r.bottom)) continue;
            if (!occupied.some(p=>Math.abs(p.x-candidate.x)<124 && Math.abs(p.y-candidate.y)<73)) {point=candidate;break;}
          }
          // A hidden label never removes its boundary or combines its totals with a neighbour.
          if (!point) continue;
          occupied.push(point);
          const position = map.containerPointToLatLng(point);
          if (!point.equals(anchor)) L.polyline([r.coord,position],{pane:'regions',color:'#416687',weight:1,interactive:false}).addTo(leaders);
          const {summary,average,title} = describe(r);
          const marker = L.marker(position,{title,keyboard:true,bubblingMouseEvents:false,
            icon:L.divIcon({className:'apt-marker region-marker',iconSize:[120,68],iconAnchor:[60,34],
              html:`<div class="region-label"><span>${escape(r.name)}</span><strong>${average}</strong><small>${summary.count.toLocaleString()}개 단지</small></div>`})}).addTo(labels);
          bindLayer(marker,r);
        }
      }
      return paths.filter(path=>!cache.has(path));
    }
    async function render() {
      const version = ++token, missing = draw();
      report(missing.length ? 'loading' : 'ready', meta.year);
      if (!missing.length) return;
      const results = await Promise.allSettled(missing.map(fetchShard));
      if (version !== token) return;
      draw();
      report(results.some(r=>r.status==='rejected') ? 'error' : 'ready',meta.year);
    }
    return {
      render,
      setMatches(matches, region) {
        groups = model.regionGroups(matches);
        summaries = new Map([...groups].map(([id,members])=>[id,model.clusterSummary(members)]));
        filterRegion = region;
      },
      regionName(c) { return (c.admin || []).length === 3 ? regions.get(c.admin[2])?.fullName : null; },
      members(id) {return groups.get(id) || [];}
    };
  }
  root.NodoMapRegions = {create};
})(window);
