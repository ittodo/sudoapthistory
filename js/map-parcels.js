/* Current complexes use pre-unioned outlines. Legacy parcels retain shared ownership. */
(function(root) {
  'use strict';
  function create({map, client, tap, choose, report}) {
    const model=root.NodoMapModel, cache=new Map(), pending=new Map(), extra=new Map(), extraBounds=new Map(), layers=new Map();
    let matches=[], selected=null, owners=new Map(), corrections=new Map(), boundaries=new Map(), version=0;
    map.createPane('apartments'); map.getPane('apartments').style.zIndex='410';
    const group=L.layerGroup().addTo(map);
    const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    function features(pnu, members) {
      const b=boundaries.get(pnu);
      if(b)return cache.get(`data/map/boundaries/${b.region}.json`)?.[b.key];
      return corrections.get(pnu) || extra.get(pnu) || members.map(m=>cache.get(`data/map/parcels/${m.complex.g}.json`)?.[pnu]).find(Boolean);
    }
    function activate(pnu,event) {
      if (!tap.accept('parcel:'+pnu,event.originalEvent?.timeStamp)) return;
      const point=event.latlng, hits=new Map((owners.get(pnu)||[]).map(m=>[m.complex.id,m]));
      for (const [other,entry] of layers) if (other!==pnu && entry.layer.getBounds().contains(point) &&
        entry.fc.features.some(f=>model.geometryContains(f.geometry,[point.lng,point.lat]))) {
        for (const m of owners.get(other)||[]) hits.set(m.complex.id,m);
      }
      choose([...hits.values()].sort((a,b)=>a.complex.id.localeCompare(b.complex.id)),point);
    }
    function draw() {
      const bounds=map.getBounds().pad(.08), show=map.getZoom()>=13;
      if(!show&&!selected){if(layers.size){group.clearLayers();layers.clear();}owners.clear();return [];}
      corrections=new Map();boundaries=new Map();
      const keys=new Map(matches.map(m=>{
        if(m.complex.boundaryKey){
          const id=`boundary:${m.complex.id}`;
          boundaries.set(id,{key:m.complex.boundaryKey,region:m.complex.g,source:m.complex.boundarySource});
          return [m.complex.id,[id]];
        }
        const ids=[...m.complex.pnus];
        for(const [i,c] of (m.complex.corrections||[]).entries()) {
          if(!['Polygon','MultiPolygon'].includes(c.geometry?.type))continue;
          const id=`correction:${m.complex.id}:${i}`;
          corrections.set(id,{type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:c.geometry}]});ids.push(id);
        }
        return [m.complex.id,ids];
      }));
      const visible=matches.filter(m=>m.complex.id===selected?.id || show && (
        (m.complex.displayBounds||m.complex.parcelBounds) && L.latLngBounds(m.complex.displayBounds||m.complex.parcelBounds).intersects(bounds) ||
        m.complex.pnus.some(p=>extraBounds.get(p)?.intersects(bounds))));
      // Include every filtered owner, including a shared parcel's other apartment.
      const wanted=new Set(visible.flatMap(m=>keys.get(m.complex.id)));
      owners=new Map();
      for (const m of matches) for (const p of keys.get(m.complex.id)) if(wanted.has(p)) {
        if(!owners.has(p))owners.set(p,[]); owners.get(p).push(m);
      }
      const drawn=new Set();
      for (const [pnu,members] of owners) {
        const fc=features(pnu,members); if(!fc?.features?.length)continue;
        let entry=layers.get(pnu);
        if(entry&&entry.fc!==fc){group.removeLayer(entry.layer);layers.delete(pnu);entry=null;}
        if(!entry) {
          const layer=L.geoJSON(fc,{pane:'apartments',bubblingMouseEvents:false,
            onEachFeature(f,path) {
              path.on('add',()=>{const el=path.getElement();if(el){el.dataset.mapTarget='parcel:'+pnu;if(boundaries.has(pnu))el.dataset.complexBoundary=boundaries.get(pnu).key;else if(!corrections.has(pnu))el.dataset.parcelPnu=pnu;}});
              path.on('click',event=>activate(pnu,event));
            }});
          entry={layer,fc};
          if(!layer.getBounds().intersects(bounds))continue;
          layers.set(pnu,entry);layer.addTo(group);
        }
        if(!entry.layer.getBounds().intersects(bounds))continue;
        drawn.add(pnu);
        const active=members.some(m=>m.complex.id===selected?.id);
        const corrected=corrections.has(pnu)||boundaries.get(pnu)?.source==='review_display_correction';
        if(entry.active!==active){entry.layer.setStyle({color:'#14b8a6',weight:active?3:1,opacity:active?1:.75,fillColor:'#2dd4bf',fillOpacity:active?.16:0,dashArray:corrected?'6 4':null});entry.active=active;}
        const title=members.map(m=>escape(m.complex.n)+(corrected?' · 검토 보정 경계':boundaries.has(pnu)?' · 단지 외곽선':m.complex.scope.startsWith('representative')?' · 대표 필지':'')).join('<br>');
        if(entry.title!==title){entry.layer.unbindTooltip();entry.layer.bindTooltip(title,{sticky:true});entry.title=title;}
      }
      for(const [pnu,entry] of layers)if(!drawn.has(pnu)){group.removeLayer(entry.layer);layers.delete(pnu);}
      return [...new Set(visible.flatMap(m=>m.complex.boundaryKey?[`data/map/boundaries/${m.complex.g}.json`]:m.complex.pnus.length?[`data/map/parcels/${m.complex.g}.json`]:[]))].filter(path=>!cache.has(path));
    }
    async function render(nextMatches=matches,nextSelected=selected) {
      matches=nextMatches;selected=nextSelected;
      const token=++version, missing=draw();
      report(missing.length?'loading':'ready');
      if(!missing.length)return;
      const results=await Promise.allSettled(missing.map(path=>{
        if(!pending.has(path))pending.set(path,client(path).then(data=>cache.set(path,data)).finally(()=>pending.delete(path)));
        return pending.get(path);
      }));
      if(token!==version)return;
      draw();report(results.some(r=>r.status==='rejected')?'error':'ready');
    }
    return {render, acceptParcel(pnu,fc){extra.set(pnu,fc);extraBounds.set(pnu,L.geoJSON(fc).getBounds());}};
  }
  root.NodoMapParcels={create};
})(window);
