/* Visible cached parcels are drawn once per PNU, without merging apartment identities. */
(function(root) {
  'use strict';
  function create({map, client, tap, choose, report}) {
    const model=root.NodoMapModel, cache=new Map(), pending=new Map(), extra=new Map(), extraBounds=new Map(), layers=new Map();
    let matches=[], selected=null, owners=new Map(), version=0;
    map.createPane('apartments'); map.getPane('apartments').style.zIndex='410';
    const group=L.layerGroup().addTo(map);
    const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    function features(pnu, members) {
      return extra.get(pnu) || members.map(m=>cache.get(m.complex.g)?.[pnu]).find(Boolean);
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
      const visible=matches.filter(m=>m.complex.id===selected?.id || show && (
        m.complex.parcelBounds && L.latLngBounds(m.complex.parcelBounds).intersects(bounds) ||
        m.complex.pnus.some(p=>extraBounds.get(p)?.intersects(bounds))));
      // Include every filtered owner, including a shared parcel's other apartment.
      const wanted=new Set(visible.flatMap(m=>m.complex.pnus));
      owners=new Map();
      for (const m of matches) for (const p of m.complex.pnus) if(wanted.has(p)) {
        if(!owners.has(p))owners.set(p,[]); owners.get(p).push(m);
      }
      const drawn=new Set();
      for (const [pnu,members] of owners) {
        const fc=features(pnu,members); if(!fc?.features?.length)continue;
        let entry=layers.get(pnu);
        if(!entry) {
          const layer=L.geoJSON(fc,{pane:'apartments',bubblingMouseEvents:false,
            onEachFeature(f,path) {
              path.on('add',()=>{const el=path.getElement();if(el){el.dataset.mapTarget='parcel:'+pnu;el.dataset.parcelPnu=pnu;}});
              path.on('click',event=>activate(pnu,event));
            }});
          entry={layer,fc};
          if(!layer.getBounds().intersects(bounds))continue;
          layers.set(pnu,entry);layer.addTo(group);
        }
        if(!entry.layer.getBounds().intersects(bounds))continue;
        drawn.add(pnu);
        const active=members.some(m=>m.complex.id===selected?.id);
        entry.layer.setStyle({color:'#14b8a6',weight:active?3:1,opacity:active?1:.75,fillColor:'#2dd4bf',fillOpacity:active?.16:0});
        const title=members.map(m=>escape(m.complex.n)+(m.complex.scope.startsWith('representative')?' · 대표 필지':'')).join('<br>');
        if(entry.title!==title){entry.layer.unbindTooltip();entry.layer.bindTooltip(title,{sticky:true});entry.title=title;}
      }
      for(const [pnu,entry] of layers)if(!drawn.has(pnu)){group.removeLayer(entry.layer);layers.delete(pnu);}
      return [...new Set(visible.map(m=>m.complex.g))].filter(g=>!cache.has(g));
    }
    async function render(nextMatches=matches,nextSelected=selected) {
      matches=nextMatches;selected=nextSelected;
      const token=++version, missing=draw();
      report(missing.length?'loading':'ready');
      if(!missing.length)return;
      const results=await Promise.allSettled(missing.map(g=>{
        if(!pending.has(g))pending.set(g,client(`data/map/parcels/${g}.json`).then(data=>cache.set(g,data)).finally(()=>pending.delete(g)));
        return pending.get(g);
      }));
      if(token!==version)return;
      draw();report(results.some(r=>r.status==='rejected')?'error':'ready');
    }
    return {render, acceptParcel(pnu,fc){extra.set(pnu,fc);extraBounds.set(pnu,L.geoJSON(fc).getBounds());}};
  }
  root.NodoMapParcels={create};
})(window);
