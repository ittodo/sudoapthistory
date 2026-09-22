import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('rental date loads retain the completed frame; tenure and filter changes clear incompatible prices',async()=>{
 let shownSummaries;
 const layers=new Set(),status={setAttribute(){}},host={classList:{toggle(){}},append(){}},settings={type:'jeonse',day:'2024-02-01',convert:true,contract:'all'};
 const map={setView(){return this;},getBounds:()=>({contains:()=>true}),getZoom:()=>17,on(){},closePopup(){},removeLayer:m=>layers.delete(m)};
 const context=vm.createContext({window:{},location:{hash:''},URLSearchParams,settings,ResizeObserver:class{observe(){}},
  document:{querySelector:()=>host,createElement:()=>status},fetch:async()=>({ok:true,json:async()=>({d:[],meta:{sources:{}}})}),createVerifiedDataClient:()=>()=>{},NodoRental:{REGIONS:['41','11','28']},
  NodoMapRegions:{create:()=>({render(){},setSummaries(values){shownSummaries=values;}})},
  L:{map:()=>map,control:{zoom:()=>({addTo(){}})},tileLayer:()=>({addTo(){}}),divIcon:x=>x,marker:(anchor,options)=>({options,element:{innerHTML:options.icon.html},getElement(){return this.element;},addTo(){layers.add(this);return this;},on(){},setLatLng(){},setIcon(){assert.fail('Existing marker DOM must be reused like the sale map');}})},
  NodoMapModel:{bindMapTap(){},labelPosition:()=>[37,127]}});
 vm.runInContext(readFileSync(new URL('../js/rental-map-view.js',import.meta.url),'utf8'),context);
 const view=context.window.NodoRentalMapView({settings,refresh(){},stop(){},esc:String,money:String});
 await new Promise(resolve=>setImmediate(resolve));
 const point={id:'a',name:'단지',coord:[37,127],admin:[],area:59,deposit:45000,rent:80,value:160};
 view.setData([point]);assert.match([...layers][0].options.icon.html,/전세 45000/);
 settings.type='monthly';assert.equal(view.beginView(),true);assert.equal(layers.size,0);assert.equal(shownSummaries.length,0);assert.match(status.textContent,/월세.*불러오는 중/);
 view.redraw();assert.equal(layers.size,0,'redrawing during a download must not restore old prices');
 view.setData([point]);assert.match([...layers][0].options.icon.html,/월 환산 160/);
 settings.bounds={south:37};settings.zoom=16;assert.equal(view.beginView(),false);assert.equal(layers.size,1);
 for(const type of ['monthly','jeonse']){
  settings.type=type;view.beginView();settings.day='2024-02-01';const totals=[['dong',{average:100,count:1}]];view.setData([point],totals);
  const marker=[...layers][0],element=marker.getElement(),previousHTML=element.innerHTML;
  settings.day='2020-09-01';assert.equal(view.beginView(),false);view.redraw();
  assert.equal(layers.size,1);assert.equal([...layers][0],marker);assert.equal(element.innerHTML,previousHTML);assert.equal(shownSummaries,totals,'region averages also stay visible during loading');
  assert.match(status.textContent,/2024-02-01/,'pending data must keep the displayed date');
  const nextTotals=[['dong',{average:110,count:1}]];view.setData([{...point,deposit:46000,value:170}],nextTotals);assert.equal(shownSummaries,nextTotals);
  assert.equal([...layers][0],marker);assert.equal(marker.getElement(),element);
  assert.match(element.innerHTML,type==='monthly'?/월 환산 170/:/전세 46000/);
  assert.match(element.title,type==='monthly'?/월 환산 170/:/전세 46000/);
  assert.match(status.textContent,/2020-09-01/);
  settings.day='2019-01-01';view.beginView();view.setData([]);assert.equal(layers.size,0,'a completed empty result removes old markers');
 }
 settings.type='monthly';view.setData([point]);settings.convert=false;assert.equal(view.beginView(),true);assert.equal(layers.size,0);
 view.setData([point]);settings.contract='new';assert.equal(view.beginView(),true);assert.equal(layers.size,0);
 view.setData([point]);settings.type='sale';view.beginView();assert.equal(layers.size,0);
 settings.type='jeonse';view.beginView();assert.equal(layers.size,0);
});

test('a superseded request cannot paint after asynchronous map initialization',async()=>{
 const source=readFileSync(new URL('../js/rental-app.js',import.meta.url),'utf8');
 const render=source.slice(source.indexOf(' async function renderMap('),source.indexOf(' function drawMap()'));
 let release;const ready=new Promise(resolve=>{release=resolve;}),painted=[];
 const context=vm.createContext({window:{L:{}},script:()=>ready,settings:{},refresh(){},stop(){},request(){},detailURL(){},esc:String,money:String,
  NodoRentalMapView:()=>({map:{},setData:points=>painted.push(points)})});
 vm.runInContext('let mapView,mapCreating,map,frame=1;'+render,context);
 const old=vm.runInContext('renderMap(["old"],[],1)',context);
 vm.runInContext('frame=2',context);
 const current=vm.runInContext('renderMap(["current"],[],2)',context);
 release();await Promise.all([old,current]);
 assert.deepEqual(JSON.parse(JSON.stringify(painted)),[['current']]);
});
