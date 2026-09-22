import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('rental context changes clear prices immediately while viewport changes retain them',()=>{
 const layers=new Set(),status={setAttribute(){}},host={classList:{toggle(){}},append(){}},settings={type:'jeonse',day:'2024-02-01',convert:true,contract:'all'};
 const map={setView(){return this;},getBounds:()=>({contains:()=>true}),getZoom:()=>17,on(){},closePopup(){},removeLayer:m=>layers.delete(m)};
 const context=vm.createContext({window:{},location:{hash:''},URLSearchParams,settings,ResizeObserver:class{observe(){}},
  document:{querySelector:()=>host,createElement:()=>status},fetch:()=>new Promise(()=>{}),
  L:{map:()=>map,control:{zoom:()=>({addTo(){}})},tileLayer:()=>({addTo(){}}),divIcon:x=>x,marker:(anchor,options)=>({options,addTo(){layers.add(this);return this;},on(){},setLatLng(){},setIcon(icon){this.options.icon=icon;}})},
  NodoMapModel:{bindMapTap(){},labelPosition:()=>[37,127]}});
 vm.runInContext(readFileSync(new URL('../js/rental-map-view.js',import.meta.url),'utf8'),context);
 const view=context.window.NodoRentalMapView({settings,refresh(){},stop(){},esc:String,money:String});
 const point={id:'a',name:'단지',coord:[37,127],admin:[],area:59,deposit:45000,rent:80,value:160};
 view.setData([point]);assert.match([...layers][0].options.icon.html,/전세 45000/);
 settings.type='monthly';assert.equal(view.beginView(),true);assert.equal(layers.size,0);assert.match(status.textContent,/월세.*불러오는 중/);
 view.redraw();assert.equal(layers.size,0,'redrawing during a download must not restore old prices');
 view.setData([point]);assert.match([...layers][0].options.icon.html,/월 환산 160/);
 settings.bounds={south:37};settings.zoom=16;assert.equal(view.beginView(),false);assert.equal(layers.size,1);
 settings.day='2020-09-01';view.beginView();assert.equal(layers.size,0);assert.match(status.textContent,/2020-09-01/);
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
