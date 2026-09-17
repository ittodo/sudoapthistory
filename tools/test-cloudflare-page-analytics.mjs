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
