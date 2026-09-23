import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync('js/page-analytics.js','utf8');
function browser(path='/map/',fetchResult=()=>Promise.resolve({status:200})){
 const calls=[],listeners={};let id=0;
 const window={addEventListener:(name,fn)=>listeners[name]=fn};
 const context=vm.createContext({window,location:{pathname:path},crypto:{randomUUID:()=>String(++id)},Date,JSON,fetch:(...args)=>{calls.push(args);return fetchResult();},setTimeout:fn=>fn()});
 vm.runInContext(source,context);return {calls,listeners,context};
}
test('one anonymous load, no query or tab handlers, bfcache counts a new view',()=>{
 const b=browser('/apartment/index.html');assert.equal(b.calls.length,1);
 const payload=JSON.parse(b.calls[0][1].body);assert.equal(payload.path,'/apartment/');
 assert.deepEqual(Object.keys(payload).sort(),['eventId','path','sentAt']);assert.equal(b.calls[0][1].credentials,'omit');
 vm.runInContext(source,b.context);assert.equal(b.calls.length,1);
 assert.deepEqual(Object.keys(b.listeners),['pageshow']);b.listeners.pageshow({persisted:false});assert.equal(b.calls.length,1);
 b.listeners.pageshow({persisted:true});assert.equal(b.calls.length,2);assert.notEqual(JSON.parse(b.calls[1][1].body).eventId,payload.eventId);
 assert.equal(browser().calls.length,1,'a fresh document (reload) counts again');
});
test('admin and authentication never send events; failures retry the same ID once',async()=>{
 for(const p of ['/admin/','/auth/google','/api/session'])assert.equal(browser(p).calls.length,0);
 const b=browser('/',()=>Promise.reject(Error('offline')));await new Promise(resolve=>setImmediate(resolve));
 assert.equal(b.calls.length,2);assert.equal(b.calls[0][1].body,b.calls[1][1].body);
});
test('all public non-redirect HTML pages load the tracker exactly once',async()=>{
 const {execFileSync}=await import('node:child_process');
 const {publicAsset}=await import('./build-cloudflare-assets.mjs');
 for(const path of execFileSync('git',['ls-files'],{encoding:'utf8'}).trim().split('\n')){
  if(!path.endsWith('.html')||!publicAsset(path)||path.startsWith('admin/'))continue;
  const html=readFileSync(path,'utf8');if(/http-equiv="refresh"/i.test(html))continue;
  assert.equal((html.match(/src="\/js\/page-analytics.js"/g)||[]).length,1,path);
 }
});

function googleBrowser({url='https://nodostream.com/map/',embedded=false,blocked=false,referrer='https://www.google.com/search?q=apartment'}={}){
 const scripts=[],calls=[],listeners={};
 const window={addEventListener:(name,fn)=>listeners[name]=fn};window.top=embedded?{}:window;
 const document={referrer,createElement:()=>({}),head:{appendChild:script=>{if(blocked)throw Error('blocked');scripts.push(script);}}};
 const context=vm.createContext({window,document,location:new URL(url),URL,URLSearchParams,crypto:{randomUUID:()=> 'page-event'},Date,JSON,fetch:(...args)=>{calls.push(args);return Promise.resolve({status:200});},setTimeout:fn=>fn()});
 vm.runInContext(source,context);
 return {window,scripts,calls,listeners,context,commands:()=>Array.from(window.dataLayer||[],args=>Array.from(args))};
}

test('GA4 initializes once on production with one automatic page view and no sensitive URL inputs',()=>{
 const b=googleBrowser({url:'https://nodostream.com/calc/?income=secret&email=private&utm_source=cafe&utm_medium=referral#salary'});
 assert.equal(b.scripts.length,1);assert.equal(b.scripts[0].async,true);
 assert.equal(b.scripts[0].src,'https://www.googletagmanager.com/gtag/js?id=G-4SPGCJTJJP');
 const commands=b.commands();assert.deepEqual(commands.map(c=>c[0]),['js','config']);
 assert.equal(commands[1][1],'G-4SPGCJTJJP');
 assert.equal(commands[1][2].page_location,'https://nodostream.com/calc/?utm_source=cafe&utm_medium=referral');
 assert.equal(commands[1][2].page_referrer,'https://www.google.com/search');
 assert.equal(commands[1][2].allow_google_signals,false);assert.equal(commands[1][2].allow_ad_personalization_signals,false);
 assert.equal(commands[1][2].user_id,undefined);
 vm.runInContext(source,b.context);assert.equal(b.scripts.length,1);assert.equal(b.commands().length,2);
 assert.equal(b.calls.length,1,'first-party collection remains active');
 b.listeners.pageshow({persisted:true});assert.equal(b.commands().length,2,'no extra manual GA page view on restore');
 assert.equal(b.calls.length,2);
 assert.equal(googleBrowser({url:'https://www.nodostream.com/'}).scripts.length,1);
});

test('GA4 excludes previews, embedded panels and private routes; Google failure leaves local counts working',()=>{
 for(const url of ['http://localhost:8765/','https://nodostream-staging.workers.dev/','https://nodostream.com.evil.example/','http://nodostream.com/','https://nodostream.com/admin/','https://nodostream.com/auth/google','https://nodostream.com/api/session']){
  const b=googleBrowser({url});assert.equal(b.scripts.length,0,url);assert.equal(b.commands().length,0,url);
 }
 const embedded=googleBrowser({embedded:true});assert.equal(embedded.scripts.length,0);assert.equal(embedded.calls.length,1);
 assert.equal(googleBrowser({blocked:true}).calls.length,1);
 assert.equal(googleBrowser({referrer:'invalid'}).commands()[1][2].page_referrer,'');
});
