import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../js/apartment-links.js',import.meta.url),'utf8');
function environment({wide=true,embedded=false,path,trackNavigation=false}={}){
 const origin='https://site.test';let href=origin+(path||(embedded?'/apartment/?id=A&view=panel&panelKey=child':'/?filter=kept'));
 const events={},messages=[],navigations=[],selectionChanges=[],classes=new Set(),stored=new Map();let sequence=0;
 const entries=[href];let position=0;
 function move(value,push){href=new URL(value,href).href;if(push){entries.splice(++position);entries.push(href);}else entries[position]=href;}
 const classList={add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),toggle(x,on){if(on)classes.add(x);else classes.delete(x);}};
 const location={get href(){return href;},get origin(){return origin;},get pathname(){return new URL(href).pathname;},get search(){return new URL(href).search;},get hash(){return new URL(href).hash;},assign:x=>{navigations.push(x);if(trackNavigation)move(x,true);},replace:x=>{navigations.push(x);if(trackNavigation)move(x,false);}};
 const frame={src:'',getAttribute:()=>frame.src,contentWindow:{location:{replace:x=>{frame.src=x;}},postMessage:()=>{}}};
 const buttons=Object.fromEntries(['#detail-close','#detail-copy','#detail-open-page'].map(x=>[x,{}]));
 const panel={style:{},setAttribute(){},querySelector:s=>s==='iframe'?frame:buttons[s],remove(){}};
 const host={classList};
 const document={readyState:'loading',activeElement:null,body:{classList,append(){}},createElement:()=>panel,querySelector:s=>s==='.nodo-header'?{getBoundingClientRect:()=>({bottom:80})}:host,querySelectorAll:()=>[],addEventListener:(name,fn)=>{events['document:'+name]=fn;}};
 const context={URL,URLSearchParams,Event:class{constructor(type){this.type=type;}},document,location,navigator:{clipboard:{writeText:async()=>{}}},sessionStorage:{setItem(k,v){stored.set(k,v);},getItem(k){return stored.get(k)??null;}},crypto:{randomUUID:()=>String(++sequence)},history:{state:null,pushState(_s,_t,u){move(u,true);},replaceState(_s,_t,u){move(u,false);},back(){if(position>0){href=entries[--position];events.popstate?.();}},forward(){if(position<entries.length-1){href=entries[++position];events.popstate?.();}}},matchMedia:()=>({matches:wide,addEventListener(){}}),addEventListener:(name,fn)=>{events[name]=fn;},dispatchEvent(event){if(event.type==='nodo:detail-selection')selectionChanges.push(context.NodoApartmentLinks.selection()?.id??null);events[event.type]?.(event);}};
 context.window=context;context.parent=embedded?{location:{origin,pathname:'/',search:'?detail=selected',hash:''},postMessage:(d,o)=>messages.push({d,o})}:context;
 vm.createContext(context);vm.runInContext(source,context);return{context,events,messages,navigations,selectionChanges,frame,entries,get href(){return href;},hasPanel:()=>classes.has('nodo-detail-open'),key:()=>new URL(frame.src).searchParams.get('panelKey')};
}
test('desktop selections keep the search URL and ignore stale or foreign detail messages',()=>{
 const e=environment();e.context.NodoApartmentLinks.go({id:'A',area:85});assert.equal(e.navigations.length,0);assert.equal(new URL(e.href).searchParams.get('filter'),'kept');const old=e.key();
 e.context.NodoApartmentLinks.go({id:'B',area:59});const key=e.key();assert.notEqual(old,key);
 const emit=(key,url,origin='https://site.test',source=e.frame.contentWindow)=>e.events.message({origin,source,data:{type:'nodo:detail-navigate',key,url}});
 emit(old,'/calc/');emit(key,'/calc/','https://other.test');emit(key,'/calc/','https://site.test',{});emit(key,'https://other.test/');emit(key,'/admin/');assert.equal(e.navigations.length,0);
 emit(key,'/calc/?fromApartment=1');assert.equal(e.navigations[0],'/calc/?fromApartment=1');
});
test('mobile selection opens a normal detail URL and preserves the old row identity',()=>{
 const e=environment({wide:false});e.context.NodoApartmentLinks.go({row:42,area:85});assert.equal(e.navigations[0],'/apartment/?row=42&area=85&tab=overview');
});
test('embedded detail publishes clean share URLs and returns login to its parent search',()=>{
 const e=environment({embedded:true});e.context.NodoApartmentLinks.sync();assert.equal(e.messages[0].d.url,'/apartment/?id=A');assert.equal(e.messages[0].d.key,'child');assert.equal(e.messages[0].o,'https://site.test');assert.equal(e.context.NodoApartmentLinks.returnURL(),'/?detail=selected');e.context.NodoApartmentLinks.navigate('/auth/google?returnTo=x');assert.equal(e.messages[1].d.type,'nodo:detail-navigate');assert.equal(e.navigations.length,0);
});

test('direct desktop detail is restored in the search workspace without losing filters or comments',()=>{
 const e=environment({path:'/apartment/?row=42&area=85&tab=rent&rentType=monthly&comment=7'});
 const target=new URL(e.navigations[0],'https://site.test');
 assert.equal(target.pathname,'/');
 assert.equal(target.searchParams.get('detail'),'/apartment/?row=42&area=85&tab=rent&rentType=monthly&comment=7');
});
test('explicit full screen and mobile direct entry stay standalone',()=>{
 for(const args of [{path:'/apartment/?id=A&view=full'},{wide:false,path:'/apartment/?id=A'}]){
  assert.equal(environment(args).navigations.length,0);
 }
});
test('a detail-to-detail navigation keeps its desktop host',()=>{
 const e=environment();e.context.NodoApartmentLinks.go({id:'A'});
 e.events.message({origin:'https://site.test',source:e.frame.contentWindow,data:{type:'nodo:detail-navigate',key:e.key(),url:'/apartment/?id=B&tab=comments&comment=7'}});
 assert.equal(e.navigations.length,0);assert.equal(new URL(e.frame.src).searchParams.get('id'),'B');
});

test('shared detail selection follows close, history and authenticated iframe identity changes',()=>{
 const e=environment({path:'/map/#mode=price&date=2020-01-31'}),links=e.context.NodoApartmentLinks;
 assert.equal(links.selection(),null);
 links.go({id:'public-A'});const oldKey=e.key();
 assert.equal(links.selection().id,'public-A');
 links.go({id:'public-B'});
 e.context.history.back();assert.equal(links.selection().id,'public-A');
 e.context.history.back();assert.equal(links.selection(),null);
 e.context.history.forward();assert.equal(links.selection().id,'public-A');
 const state=(key,url)=>e.events.message({origin:'https://site.test',source:e.frame.contentWindow,data:{type:'nodo:detail-state',key,url}});
 state(oldKey,'/apartment/?id=stale');assert.equal(links.selection().id,'public-A');
 const count=e.selectionChanges.length;
 state(e.key(),'/apartment/?id=public-A&tab=trades');assert.equal(e.selectionChanges.length,count,'tab changes do not redraw identity selection');
 state(e.key(),'/apartment/?id=canonical-A&tab=trades');assert.equal(links.selection().id,'canonical-A');
 assert.equal(new URL(e.href).searchParams.get('detail'),'/apartment/?id=canonical-A&tab=trades');
 links.close();assert.equal(links.selection(),null);assert.equal(e.selectionChanges.at(-1),null);
 assert.equal(new URLSearchParams(new URL(e.href).hash.slice(1)).has('a'),false);
});

test('direct restored detail selection remains available to map data that loads later',()=>{
 const e=environment({path:'/map/?detail='+encodeURIComponent('/apartment/?id=public-A&tab=trades')+'#mode=price&date=2020-01-31'});
 e.events['document:DOMContentLoaded']();assert.equal(e.context.NodoApartmentLinks.selection().id,'public-A');
 const mapSource=readFileSync(new URL('../js/map-app.js',import.meta.url),'utf8');
 Object.assign(e.context,{byId:new Map(),matches:new Map(),selected:null});
 vm.runInContext(mapSource.slice(mapSource.indexOf('  function highlightedComplex()'),mapSource.indexOf('  function render()')),e.context);
 assert.equal(e.context.highlightedComplex(),null);
 const current={id:'map-A'},historical={id:'map-A',areas:[{a:60}]};
 e.context.byId.set('public-A',current);e.context.matches.set('map-A',{complex:historical});
 assert.equal(e.context.highlightedComplex(),historical,'highlight uses the displayed historical complex through its public ID');
 e.context.matches.clear();assert.equal(e.context.highlightedComplex(),null,'an excluded complex stays excluded');
 e.context.matches.set('map-A',{complex:historical});e.context.NodoApartmentLinks.close();assert.equal(e.context.highlightedComplex(),null);
 assert.equal(e.context.selected,null,'highlight does not populate the old hash selection');
});

test('historical URL restoration keeps the open detail; a new date refresh closes it',async()=>{
 const e=environment({path:'/map/?detail='+encodeURIComponent('/apartment/?id=public-A')+'#mode=price&date=2020-01-31'});
 e.events['document:DOMContentLoaded']();
 const timeline=readFileSync(new URL('../js/map-timeline.js',import.meta.url),'utf8'),fields=new Map();
 Object.assign(e.context,{root:e.context,mode:'price',day:'2020-01-31',request:0,restoredOnce:false,preferences:{},renderedMode:'price',renderedDay:'2020-01-31',
  stop(){},loading:false,el:{setAttribute(){}},map:{closePopup(){}},effects:{clear(){}},applyPreference(){},sync(){},
  $:id=>{if(!fields.has(id))fields.set(id,{});return fields.get(id);},ensure:async()=>{throw Error('offline fixture');}});
 vm.runInContext(timeline.slice(timeline.indexOf('    async function refresh('),timeline.indexOf('    function write(p)')),e.context);
 vm.runInContext(timeline.slice(timeline.indexOf('    function restore()'),timeline.indexOf('    function label(match,')),e.context);
 await e.context.restore();assert.equal(e.context.NodoApartmentLinks.selection().id,'public-A');
 await e.context.refresh();assert.equal(e.context.NodoApartmentLinks.selection(),null);
});

test('a mobile rental map detail keeps its map position, date and filters for return',()=>{
 const path='/map/?tenure=monthly&rentDate=2026-09-30&rentContract=2#lat=37.54&lng=127.01&z=18&mode=price&date=2026-09-30&a=old';
 const e=environment({wide:false,path});
 e.context.NodoApartmentLinks.open('/apartment/?id=public-A&tab=rent&rentType=monthly&rentArea=59.91&area=60&rentPeriod=2026&view=full');
 const detail=new URL(e.navigations[0],'https://site.test');
 assert.equal(detail.searchParams.get('id'),'public-A');
 assert.equal(detail.searchParams.get('rentArea'),'59.91');
 const back=new URL(e.context.sessionStorage.getItem('nodoApartmentReturn'),'https://site.test');
 assert.equal(back.pathname,'/map/');assert.equal(back.searchParams.get('tenure'),'monthly');
 assert.equal(back.searchParams.get('rentDate'),'2026-09-30');assert.equal(back.searchParams.get('rentContract'),'2');
 const hash=new URLSearchParams(back.hash.slice(1));
 assert.equal(hash.get('lat'),'37.54');assert.equal(hash.get('lng'),'127.01');assert.equal(hash.get('z'),'18');
 assert.equal(hash.get('date'),'2026-09-30');assert.equal(hash.has('a'),false);
});

test('an explicit sale map selection opens the sale tab after a rental detail',()=>{
 const e=environment({path:'/map/#lat=37.54&lng=127.01&z=18&mode=price&date=2026-09-30'});
 e.context.NodoApartmentLinks.go({id:'rental-A',tab:'rent',rentType:'monthly',rentPeriod:'2025'});
 e.context.NodoApartmentLinks.go({id:'sale-B',area:59,tab:'overview',tenure:'sale'});
 const detail=new URL(e.frame.src);
 assert.equal(detail.searchParams.get('id'),'sale-B');assert.equal(detail.searchParams.get('area'),'59');
 assert.equal(detail.searchParams.get('tab'),'overview');assert.equal(detail.searchParams.has('rentType'),false);
 assert.equal(new URLSearchParams(new URL(e.href).hash.slice(1)).get('date'),'2026-09-30');
});

function historicalMap({wide=true,legacy=false}={}){
 const e=environment({wide,trackNavigation:true,path:'/map/#lat=37.54&lng=127.01&z=18&mode=price&date=2026-09-30&step=month&speed=4'+(legacy?'&a=map-A':'')});
 const timeline=readFileSync(new URL('../js/map-timeline.js',import.meta.url),'utf8');
 vm.runInContext(readFileSync(new URL('../js/map-pricing.js',import.meta.url),'utf8'),e.context);
 vm.runInContext(readFileSync(new URL('../js/map-model.js',import.meta.url),'utf8'),e.context);
 vm.runInContext(readFileSync(new URL('../js/daily-model.js',import.meta.url),'utf8'),e.context);
 const actions=[];
 Object.assign(e.context,{root:e.context,M:e.context.NodoDailyModel,loading:false,currentFilters:{aH:60},filters:{aH:60},
  mode:'price',day:'2026-09-30',start:'2026-09-01',end:'2026-09-30',step:'month',speed:4,kind:'all',district:'',
  restoring:false,restoredOnce:false,preferences:{mode:'price'},pendingFocus:null,payload:{},selected:null,selectedArea:null,
  storageKey:'map-test',localStorage:{setItem(){}},remember(){},sync(){},applyPreference(){},
  $:()=>({value:'',checked:true}),map:{getCenter:()=>({lat:37.54,lng:127.01}),getZoom:()=>18,setView(){}},
  complexes:[{id:'map-A',publicationId:'public-A',coord:[37.54,127.01],areas:[
   {a:84.96,i:1,latest:[20260930,90000,0,0,1]},
   {a:59.97,i:2,latest:[20260925,70000,0,0,1]}
  ]}],stop:()=>actions.push('stop')});
 vm.runInContext(timeline.slice(timeline.indexOf('    function write(p)'),timeline.indexOf('    function label(match,')),e.context);
 vm.runInContext(timeline.slice(timeline.indexOf('    function select(id)'),timeline.indexOf('    async function tick()')),e.context);
 const mapSource=readFileSync(new URL('../js/map-app.js',import.meta.url),'utf8');
 vm.runInContext(mapSource.slice(mapSource.indexOf('  function save(push=false)'),mapSource.indexOf('  function parseState()')),e.context);
 e.context.timeline={write:e.context.write};const save=e.context.save;e.context.save=()=>{actions.push('save');save();};
 // Use the refresh completion path with a ready frame; decoding is tested separately.
 const focusStart=timeline.indexOf('if(pendingFocus){const c='),focusEnd=timeline.indexOf('pendingFocus=null;}',focusStart)+'pendingFocus=null;}'.length;
 vm.runInContext('function refresh(){'+timeline.slice(focusStart,focusEnd)+'}',e.context);
 return {...e,actions,get href(){return e.href;}};
}

for(const [exact,display] of [[59.97,60],[104.5,104],[105.5,106]])test(`a historical price selection stops playback and selects display area ${display} for exact area ${exact}`,()=>{
 const e=historicalMap();
 e.context.complexes[0].areas[1].a=exact;e.context.currentFilters={aL:exact,aH:exact};
 e.context.select('map-A');
 const detail=new URL(e.frame.src);
 assert.deepEqual(e.actions,['stop','save']);
 assert.equal(detail.searchParams.get('id'),'public-A');assert.equal(detail.searchParams.get('area'),String(display));
 assert.equal(detail.searchParams.get('tab'),'trades');assert.equal(detail.searchParams.get('tenure'),'sale');
 const hash=new URLSearchParams(new URL(e.href).hash.slice(1));
 assert.equal(hash.get('date'),'2026-09-30');assert.equal(hash.get('step'),'month');assert.equal(hash.get('speed'),'4');
 const apartmentSource=readFileSync(new URL('../js/apartment-app.js',import.meta.url),'utf8');
 const selection=apartmentSource.slice(apartmentSource.indexOf('  function selection()'),apartmentSource.indexOf('  function header()'));
 const detailContext={URLSearchParams,location:{search:detail.search},tabs:{trades:true},area:null,tab:null,apartment:{areas:[{area:display,latest:{date:20260925}},{area:85,latest:{date:20260930}},{area:105,latest:{date:20260929}}]}};
 vm.runInNewContext(selection+';selection();',detailContext);assert.equal(detailContext.area.area,display);
 e.context.loading=true;e.context.select('map-A');assert.deepEqual(e.actions,['stop','save']);
});

for(const wide of [true,false])for(const legacy of [false,true])test(`${wide?'desktop':'mobile'} historical detail returns to the map without reopening${legacy?' after a legacy deep link':''}`,()=>{
 const e=historicalMap({wide,legacy});
 if(legacy)e.context.restore();else e.context.select('map-A');
 assert.equal(e.entries.length,2);
 const prior=new URL(e.entries[0]),priorHash=new URLSearchParams(prior.hash.slice(1));
 assert.equal(prior.pathname,'/map/');assert.equal(prior.searchParams.has('detail'),false);assert.equal(priorHash.has('a'),false);
 e.context.history.back();e.context.restore();
 assert.equal(e.entries.length,2);assert.equal(e.href,e.entries[0]);assert.equal(e.hasPanel(),false);
 assert.equal(e.context.pendingFocus,null);
 const hash=new URLSearchParams(new URL(e.href).hash.slice(1));
 for(const [key,value]of Object.entries({lat:'37.54000',lng:'127.01000',z:'18',date:'2026-09-30',step:'month',speed:'4',aH:'60'}))assert.equal(hash.get(key),value,key);
 if(!wide)assert.equal(e.navigations.length,1);
});
