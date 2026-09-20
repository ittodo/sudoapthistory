import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

// Controlled DOM/worker boundary: verify input races, IME and keyboard behavior,
// without downloading trade histories or depending on browser timing.
function fixture(url='http://localhost/trades/?tenure=sale'){
  class Element {
    constructor(tag='div'){this.tagName=tag;this.children=[];this.attrs={};this.events={};this.hidden=false;this.value='';this.dataset={};this.style={};this.labels=[];this._text='';}
    set textContent(v){this.children=[];this._text=String(v);}
    get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}
    append(...nodes){nodes.forEach(n=>{this.children.push(n);n.parentElement=this;});}
    replaceChildren(...nodes){this.children=[];this._text='';this.append(...nodes);}
    setAttribute(k,v){this.attrs[k]=String(v);}getAttribute(k){return this.attrs[k]??null;}removeAttribute(k){delete this.attrs[k];}
    addEventListener(k,fn){(this.events[k]??=[]).push(fn);}
    emit(k,extra={}){const e={target:this,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;},...extra};for(const fn of this.events[k]||[])fn(e);return e;}
    closest(){return form;}contains(n){return n===this || this.children.some(c=>c.contains?.(n));}
    getBoundingClientRect(){return {left:10,top:100,bottom:140,width:240};}
    cloneNode(){const copy=new Element(this.tagName);copy.textContent=this.textContent;return copy;}
    scrollIntoView(){}focus(){document.activeElement=this;}
  }
  const document=new Element(),window=new Element(),form=new Element('form'),input=new Element('input');
  document.documentElement={clientWidth:375};document.head=new Element('head');document.body=new Element('body');document.createElement=t=>new Element(t);document.createTextNode=t=>{const el=new Element('#text');el.textContent=t;return el;};form.append(input);document.activeElement=input;
  const location={href:url,get search(){return new URL(this.href).search;}},history={state:null,replaceState(s,_,u){this.state=s;location.href=String(u);},pushState(s,_,u){this.state=s;location.href=String(u);}};
  const timers=new Map();let timerId=0;const workers=[];
  class Worker {constructor(){this.messages=[];workers.push(this);}postMessage(m){this.messages.push(m);}terminate(){}reply(result,id=this.messages.at(-1).id){this.onmessage({data:{id,result,ms:1,prepareMs:2,version:'test'}});}error(message){this.onmessage({data:{id:this.messages.at(-1).id,error:message}});}}
  const context={window,document,location,history,Worker,URL,URLSearchParams,performance,requestAnimationFrame:fn=>fn(),innerWidth:390,innerHeight:844,queueMicrotask,setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);}};
  vm.runInNewContext(readFileSync(new URL('../js/apartment-search.js',import.meta.url),'utf8'),context);
  let scope={r:1,g:''},selected=0,cleared=0;
  const binding=window.NodoApartmentSearch.bind(input,{scope:()=>scope,onSelect:()=>selected++,onClear:()=>cleared++});
  const popup=document.body.children[0],list=popup.children[0],notice=form.children.at(-1);
  const tick=ms=>{for(const [id,t]of [...timers])if(t.ms===ms){timers.delete(id);t.fn();}};
  const type=value=>{input.value=value;input.emit('input');tick(150);};
  return {input,form,window,document,popup,list,notice,binding,workers,location,type,tick,get selected(){return selected;},get cleared(){return cleared;},setScope(s){scope=s;binding.checkScope();}};
}
const apartment={id:'a',name:'리센츠',g:'송파구',d:'잠실동',r:1,keys:['a','source-a'],rows:[0,2],mapIds:['map-a'],addresses:[],saleIds:['source-a'],rentalIds:['source-a'],highlights:[[0,3]]};
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('Enter does not implicitly choose first; arrows choose by ID and editing clears',async()=>{
  const f=fixture();f.type('리센');f.workers[0].reply([apartment]);await flush();
  assert.equal(f.popup.hidden,false);assert.match(f.list.textContent,/송파구 · 리센츠/);
  f.input.emit('keydown',{key:'Enter'});assert.equal(f.selected,0);assert.equal(f.binding.selected,null);
  f.input.emit('keydown',{key:'ArrowDown'});assert.match(f.input.getAttribute('aria-activedescendant'),/-0$/);
  assert.equal(f.input.emit('keydown',{key:'Enter'}).prevented,true);assert.equal(f.selected,1);
  assert.equal(new URL(f.location.href).searchParams.get('searchApt'),'a');
  assert.equal(f.binding.matches({i:0}),true);assert.equal(f.binding.matches({id:'source-b',n:'리센츠'}),false);
  f.binding.reportCount(0);assert.equal(f.notice.textContent,'단지는 있으나 현재 조회 조건에 맞는 거래가 없습니다');
  f.type('다른');assert.equal(f.binding.selected,null);assert.equal(new URL(f.location.href).searchParams.has('searchApt'),false);
});
test('composition and stale/out-of-order replies cannot open old candidates',async()=>{
  const f=fixture();f.input.emit('compositionstart');f.type('리');assert.equal(f.workers.length,0);
  f.input.emit('compositionend');f.tick(150);const first=f.workers[0].messages.at(-1).id;
  f.type('반포');const last=f.workers[0].messages.at(-1).id;
  f.workers[0].reply([apartment],first);await flush();assert.equal(f.list.children.length,0);
  f.workers[0].reply([{...apartment,name:'반포자이'}],last);await flush();assert.match(f.list.textContent,/반포자이/);
  f.input.emit('keydown',{key:'Escape'});assert.equal(f.popup.hidden,true);
  f.type('');assert.equal(f.popup.hidden,true);
});
test('scope changes clear selection, and URL restoration/back preserve only valid identity',async()=>{
  const f=fixture('http://localhost/?searchApt=a');const restored=f.binding.restore();f.workers[0].reply(apartment);await restored;
  assert.equal(f.binding.selected.id,'a');assert.equal(f.input.value,'리센츠');
  f.setScope({r:0,g:''});assert.equal(f.binding.selected,null);assert.equal(f.input.value,'');assert.match(f.notice.textContent,/지역 범위/);
  const g=fixture();g.type('리센츠');g.workers[0].reply([apartment]);await flush();g.list.children[0].onclick();
  g.location.href='http://localhost/';g.window.emit('popstate');g.tick(0);await flush();assert.equal(g.binding.selected,null);assert.equal(g.input.value,'리센츠','previous free query survives back');
});
test('a newer restore wins even when the initial catalog lookup is still pending',async()=>{
  const f=fixture('http://localhost/?searchApt=a');const first=f.binding.restore(),old=f.workers[0].messages.at(-1).id;
  f.location.href='http://localhost/?searchApt=b';f.window.emit('popstate');f.tick(0);const latest=f.workers[0].messages.at(-1).id;
  f.workers[0].reply({...apartment,id:'b',name:'반포자이'},latest);await flush();
  f.workers[0].reply(apartment,old);await first;assert.equal(f.binding.selected.id,'b');assert.equal(f.input.value,'반포자이');
});
test('failure exposes retry while free text remains usable and successful retry recovers',async()=>{
  const f=fixture();f.type('리센츠');f.workers[0].error('자료 로딩 실패');await flush();
  assert.equal(f.input.value,'리센츠');assert.equal(f.binding.selected,null);const retry=f.popup.children[1].children.at(-1);assert.equal(retry.textContent,'자동완성 재시도');
  retry.onclick();f.workers[0].reply([apartment]);await flush();assert.equal(f.list.children.length,1);
});
