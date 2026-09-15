import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../js/apartment-links.js',import.meta.url),'utf8');
function environment({wide=true,embedded=false}={}){
 const origin='https://site.test';let href=origin+(embedded?'/apartment/?id=A&view=panel&panelKey=child':'/?filter=kept');
 const events={},messages=[],navigations=[],classes=new Set();let sequence=0;
 const classList={add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x)};
 const location={get href(){return href;},get origin(){return origin;},get pathname(){return new URL(href).pathname;},get search(){return new URL(href).search;},get hash(){return new URL(href).hash;},assign:x=>navigations.push(x),replace:x=>navigations.push(x)};
 const frame={src:'',getAttribute:()=>frame.src,contentWindow:{location:{replace:x=>{frame.src=x;}},postMessage:()=>{}}};
 const buttons=Object.fromEntries(['#detail-close','#detail-copy','#detail-open-page'].map(x=>[x,{}]));
 const panel={style:{},setAttribute(){},querySelector:s=>s==='iframe'?frame:buttons[s],remove(){}};
 const host={classList};
 const document={readyState:'loading',activeElement:null,body:{classList,append(){}},createElement:()=>panel,querySelector:s=>s==='.nodo-header'?{getBoundingClientRect:()=>({bottom:80})}:host,querySelectorAll:()=>[],addEventListener:(name,fn)=>{events['document:'+name]=fn;}};
 const context={URL,URLSearchParams,Event:class{},document,location,navigator:{clipboard:{writeText:async()=>{}}},sessionStorage:{setItem(){}},crypto:{randomUUID:()=>String(++sequence)},history:{state:null,pushState(_s,_t,u){href=String(u);},replaceState(_s,_t,u){href=String(u);}},matchMedia:()=>({matches:wide,addEventListener(){}}),addEventListener:(name,fn)=>{events[name]=fn;},dispatchEvent(){}};
 context.window=context;context.parent=embedded?{location:{origin,pathname:'/',search:'?detail=selected',hash:''},postMessage:(d,o)=>messages.push({d,o})}:context;
 vm.createContext(context);vm.runInContext(source,context);return{context,events,messages,navigations,frame,get href(){return href;},key:()=>new URL(frame.src).searchParams.get('panelKey')};
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
