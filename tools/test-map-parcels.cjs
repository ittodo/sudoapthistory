const assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
require('../js/map-model.js');const model=globalThis.NodoMapModel;
function bounds(raw) {
  return {raw,intersects(other){return raw[0][0]<=other.raw[1][0]&&raw[1][0]>=other.raw[0][0]&&raw[0][1]<=other.raw[1][1]&&raw[1][1]>=other.raw[0][1];},
    contains(p){return p.lat>=raw[0][0]&&p.lat<=raw[1][0]&&p.lng>=raw[0][1]&&p.lng<=raw[1][1];},pad(){return this;}};
}
function fixture(client) {
  const groups=[], map={zoom:12,box:bounds([[0,0],[10,10]]),createPane(){},getPane(){return {style:{}};},getZoom(){return this.zoom;},getBounds(){return this.box;}};
  const L={latLngBounds:bounds,layerGroup(){const g={items:new Set(),addTo(){groups.push(this);return this;},clearLayers(){this.items.clear();},removeLayer(l){this.items.delete(l);}};return g;},
    geoJSON(fc,options={}) {
      const points=fc.features.flatMap(f=>f.geometry.coordinates.flat(2)).filter(Array.isArray);
      // Fixture polygons are single rings; handle that shape without using production bounds logic.
      const coords=points.length?points:fc.features.flatMap(f=>f.geometry.coordinates[0]);
      const box=bounds([[Math.min(...coords.map(p=>p[1])),Math.min(...coords.map(p=>p[0]))],[Math.max(...coords.map(p=>p[1])),Math.max(...coords.map(p=>p[0]))]]);
      const paths=fc.features.map(f=>{const p={handlers:{},element:{dataset:{}},on(event,handler){this.handlers[event]=handler;return this;},getElement(){return this.element;}};options.onEachFeature?.(f,p);return p;});
      return {fc,paths,style:null,getBounds(){return box;},addTo(g){g.items.add(this);paths.forEach(p=>p.handlers.add?.());return this;},setStyle(s){this.style=s;},unbindTooltip(){},bindTooltip(){}};
    }};
  const chosen=[], statuses=[], tap=model.createTapGuard(), scope={window:{NodoMapModel:model},L};
  vm.runInNewContext(fs.readFileSync(require.resolve('../js/map-parcels.js'),'utf8'),scope);
  const view=scope.window.NodoMapParcels.create({map,client,tap,choose:items=>chosen.push(items.map(m=>m.complex.id)),report:s=>statuses.push(s)});
  return {view,map,tap,chosen,statuses,layers:()=>[...groups[0].items]};
}
const fc=(x,y)=>({type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Polygon',coordinates:[[[x,y],[x+2,y],[x+2,y+2],[x,y+2],[x,y]]]}}]});
const A={id:'A',n:'A',g:'gu',coord:[50,50],parcelBounds:[[1,1],[32,32]],pnus:['one','far'],scope:'approved'};
const B={...A,id:'B',n:'B',parcelBounds:[[1,1],[3,3]],pnus:['one']};
const matches=[{complex:A},{complex:B}], shard={one:fc(1,1),far:fc(30,30)};
(async()=>{
  let calls=0;
  const f=fixture(async()=>{calls++;return shard;});
  await f.view.render(matches,null);assert.equal(calls,0,'zoom 12 does not fetch unselected parcels');
  f.map.zoom=13;await Promise.all([f.view.render(matches,null),f.view.render(matches,null)]);
  assert.equal(calls,1,'concurrent renders reuse one shard request');
  assert.equal(f.layers().length,1,'shared PNU drawn once and remote subsidiary parcel culled');
  assert.equal(f.layers()[0].style.weight,1,'visible boundary does not depend on representative coordinate');
  f.tap.begin(1,0,0,100,'parcel:one');f.tap.end(1,0,0,200);
  f.layers()[0].paths[0].handlers.click({originalEvent:{timeStamp:200},latlng:{lat:2,lng:2}});
  assert.equal(f.chosen[0].join(','),'A,B','shared parcel preserves both apartment identities');
  await f.view.render(matches,A);assert.equal(f.layers()[0].style.weight,3);
  await f.view.render(matches,null);assert.equal(f.layers()[0].style.weight,1,'closing restores thin outline');
  const retained=f.layers()[0];await f.view.render(matches,null);assert.equal(f.layers()[0],retained,'price frames retain parcel geometry');
  f.tap.begin(1,0,0,300,'parcel:one');f.tap.end(1,20,0,350);
  f.layers()[0].paths[0].handlers.click({originalEvent:{timeStamp:350},latlng:{lat:2,lng:2}});
  assert.equal(f.chosen.length,1,'fast drag never selects');
  f.map.box=bounds([[29,29],[34,34]]);await f.view.render(matches,null);
  assert.equal(f.layers().length,1);assert.equal(f.layers()[0].fc,shard.far,'detached approved member remains available');
  assert.equal(calls,1,'panning reuses cache');
  await f.view.render([],null);assert.equal(f.layers().length,0,'filter removes boundaries');
  let resolve;
  const delayed=fixture(()=>new Promise(r=>{resolve=r;}));delayed.map.zoom=13;
  const old=delayed.view.render(matches,null);await delayed.view.render([],null);resolve(shard);await old;
  assert.equal(delayed.layers().length,0,'late request cannot restore excluded apartments');
  let failed=true;
  const retry=fixture(async()=>{if(failed)throw Error('offline');return shard;});retry.map.zoom=13;
  await retry.view.render(matches,null);assert.equal(retry.statuses.at(-1),'error');failed=false;
  await retry.view.render(matches,null);assert.equal(retry.layers().length,1,'failed shard can retry');
  const fallback=fixture(async()=>({}));fallback.map.zoom=13;
  const C={...A,id:'C',parcelBounds:null,pnus:['live']};
  fallback.view.acceptParcel('live',fc(1,1));await fallback.view.render([{complex:C}],C);
  await fallback.view.render([{complex:C}],null);assert.equal(fallback.layers().length,1,'selected fallback remains a thin outline when closed');
  console.log('Parcel viewport, shared ownership, selection, gestures, cache, stale response and retry tests passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
