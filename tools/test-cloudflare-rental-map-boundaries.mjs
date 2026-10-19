import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const flush=()=>new Promise(resolve=>setImmediate(resolve));
const box=raw=>({raw,pad(){return this;},contains(p){const lat=p.lat??p[0],lng=p.lng??p[1];return lat>=raw[0][0]&&lat<=raw[1][0]&&lng>=raw[0][1]&&lng<=raw[1][1];},intersects(other){return raw[0][0]<=other.raw[1][0]&&raw[1][0]>=other.raw[0][0]&&raw[0][1]<=other.raw[1][1]&&raw[1][1]>=other.raw[0][1];}});
const geometry={type:'Polygon',coordinates:[[[127,37],[128,37],[128,38],[127,38],[127,37]]]};
const boundary={type:'FeatureCollection',features:[{type:'Feature',properties:{totalParcelCount:2,missingParcelCount:0},geometry}]};
const complex=(id,source)=>({id,publicationId:'public-'+id,n:'단지 '+id,g:'test',coord:[37.5,127.5],displayBounds:[[37,127],[38,128]],pnus:['one','two'],boundaryKey:id,boundarySource:'parcel_union',memberSources:[{id:source}],scope:'current_review'});
const point=id=>({id,name:id,coord:[37.5,127.5],admin:[],date:'2026-10-01',area:59,deposit:40000,rent:80,value:160});

async function fixture({fail=false}={}){
 const markers=new Set(),groups=[],requested=[],opened=[],statuses=[],settings={type:'jeonse',day:'2026-10-01',convert:true,contract:'all'};
 const element=()=>({children:[],classList:{toggle(){}},setAttribute(){},append(child){this.children.push(child);}});
 const host=element(),status=element(),containerEvents=new Map(),windowEvents=new Map();let popup,failRequest=fail,mapOptions,clock=0;
 const container={addEventListener(name,handler){containerEvents.set(name,handler);}};
 const map={zoom:17,setView(){return this;},createPane(){},getPane(){return {style:{}};},getContainer:()=>container,getBounds:()=>box([[36,126],[39,129]]),getZoom(){return this.zoom;},on(){},closePopup(){popup=null;},removeLayer:m=>markers.delete(m),
  latLngToContainerPoint:([lat,lng])=>({x:lng*100,y:-lat*100}),containerPointToLatLng:([x,y])=>[-y/100,x/100]};
 const L={map:(_id,options)=>{mapOptions=options;return map;},control:{zoom:()=>({addTo(){}})},tileLayer:()=>({addTo(){}}),divIcon:x=>x,latLngBounds:box,
  marker:(anchor,options)=>({handlers:{},element:{innerHTML:options.icon.html},getElement(){return this.element;},addTo(){markers.add(this);return this;},on(name,handler){this.handlers[name]=handler;return this;},setLatLng(){}}),
  layerGroup:()=>({items:new Set(),addTo(){groups.push(this);return this;},clearLayers(){this.items.clear();},removeLayer(l){this.items.delete(l);}}),
  geoJSON:(fc,options)=>{
   const paths=fc.features.map(f=>{const path={handlers:{},element:{dataset:{},closest(selector){return selector==='[data-map-target]'&&this.dataset.mapTarget?this:null;}},on(name,handler){this.handlers[name]=handler;return this;},getElement(){return mapOptions.preferCanvas?null:this.element;}};options.onEachFeature(f,path);return path;});
   return {paths,fc,getBounds:()=>box([[37,127],[38,128]]),addTo(group){group.items.add(this);paths.forEach(p=>p.handlers.add?.());return this;},setStyle(style){this.style=style;},unbindTooltip(){},bindTooltip(){}};
  },
  popup:()=>({setLatLng(){return this;},setContent(content){popup=content;return this;},openOn(){return this;}})};
 const context=vm.createContext({location:{hash:''},URLSearchParams,ResizeObserver:class{observe(){}},document:{querySelector:()=>host,createElement:tag=>tag==='p'?status:element()},L,
  fetch:async()=>({ok:true,json:async()=>({d:[complex('A','rental-A'),complex('B','rental-B')],meta:{sources:{'data/map/boundaries/test.json':'fixture-hash'}}})}),
  createVerifiedDataClient:(_root,sources)=>async path=>{assert.equal(sources[path],'fixture-hash');requested.push(path);if(failRequest)throw Error('offline');return {A:boundary,B:boundary};},
  NodoApartmentLinks:{open:url=>opened.push(url)},NodoRental:{REGIONS:['41','11','28']},NodoMapRegions:{create:()=>({render(){},setSummaries(){}})},
  addEventListener:(name,handler)=>windowEvents.set(name,handler)});
 context.window=context;
 vm.runInContext(readFileSync(new URL('../js/map-pricing.js',import.meta.url),'utf8'),context);
 vm.runInContext(readFileSync(new URL('../js/map-model.js',import.meta.url),'utf8'),context);
 vm.runInContext(readFileSync(new URL('../js/map-parcels.js',import.meta.url),'utf8'),context);
 vm.runInContext(readFileSync(new URL('../js/rental-map-view.js',import.meta.url),'utf8'),context);
 const view=context.NodoRentalMapView({settings,refresh(){},stop(){statuses.push('stopped');},esc:String,money:String,
  detailURL:p=>'/apartment/?'+new URLSearchParams({id:p.publicId||p.id,tab:'rent',rentType:settings.type,rentArea:String(p.area),rentPeriod:p.date.slice(0,4)})});
 await flush();
 function click(path,{drag=0,target=path.getElement()||{}}={}){
  clock+=1000;
  containerEvents.get('pointerdown')({pointerId:1,clientX:100,clientY:100,timeStamp:clock,target,button:0});
  windowEvents.get('pointermove')({pointerId:1,clientX:100+drag,clientY:100});
  windowEvents.get('pointerup')({pointerId:1,clientX:100+drag,clientY:100,timeStamp:clock+100});
  path.handlers.click({latlng:{lat:37.5,lng:127.5},originalEvent:{timeStamp:clock+100}});
 }
 return {view,settings,markers,requested,opened,status,map,mapOptions,click,states:statuses,layers:()=>[...groups[0].items],popup:()=>popup,retry(){failRequest=false;}};
}

test('jeonse and monthly maps share union layers, canonical detail selection, filters and cached geometry',async()=>{
 const f=await fixture();
 for(const type of ['jeonse','monthly']){
  f.settings.type=type;f.view.beginView();
  f.view.setData([point('rental-A')]);await flush();
  assert.equal(f.layers().length,1);assert.equal(f.layers()[0].paths[0].element.dataset.complexBoundary,'A');
  const layer=f.layers()[0];f.settings.day='2025-01-01';f.view.beginView();f.view.redraw();await flush();
  assert.equal(f.layers()[0],layer,'pending date changes retain the completed geometry');
  f.click(layer.paths[0]);
  const url=new URL(f.opened.at(-1),'https://example.test');
  assert.equal(url.searchParams.get('id'),'public-A');assert.equal(url.searchParams.get('rentType'),type);
  assert.equal(url.searchParams.get('rentArea'),'59');assert.equal(url.searchParams.get('rentPeriod'),'2026');
  f.view.setData([point('rental-A'),point('rental-B')]);await flush();
  f.click(f.layers()[0].paths[0]);
  assert.equal(f.popup().children.length,2,'overlapping identities remain selectable separately');
  f.popup().children[1].onclick();assert.match(f.opened.at(-1),/id=public-B/);
  f.settings.contract=type;f.view.beginView();await flush();
  assert.equal(f.layers().length,0,'a changed contract filter clears incompatible outlines');
  assert.equal(f.markers.size,0);
 }
 assert.deepEqual(f.requested,['data/map/boundaries/test.json'],'frames and tenure reuse one verified union shard, never individual parcels');
});

test('rental SVG boundary targets pass the real pointer guard while drags and missing targets do not',async()=>{
 const f=await fixture();f.view.setData([point('rental-A')]);await flush();
 assert.equal(f.mapOptions.preferCanvas,false,'Canvas has no per-boundary SVG target');
 const path=f.layers()[0].paths[0];
 assert.equal(path.getElement().dataset.mapTarget,'parcel:boundary:A');
 assert.equal(path.getElement().dataset.complexBoundary,'A');
 f.click(path,{target:{}});assert.equal(f.opened.length,0,'an unowned target must not select a boundary');
 f.click(path,{drag:20});assert.equal(f.opened.length,0,'dragging must not open detail');
 f.click(path);assert.equal(f.opened.length,1);assert.match(f.opened[0],/id=public-A/);
});

test('rental prices remain usable after a boundary download error and redraw retries it',async()=>{
 const f=await fixture({fail:true});f.view.setData([point('rental-A')]);await flush();
 assert.equal(f.markers.size,1);assert.equal(f.layers().length,0);assert.match(f.status.textContent,/일부 단지 경계 미표시/);
 f.retry();f.view.redraw();await flush();assert.equal(f.layers().length,1);assert.doesNotMatch(f.status.textContent,/미표시/);
 assert.equal(f.requested.length,2);
});
