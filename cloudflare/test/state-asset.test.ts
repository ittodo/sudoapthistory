import test from 'node:test';import assert from 'node:assert/strict';import {stateAsset} from '../src/state-asset';
const url='https://example.invalid/data/daily/regions/11680/states/2026.bin';
const input=Uint8Array.from({length:100},(_,i)=>i);
function source({status=200,length=true,chunks=7,etag='"current"'}={}){let cancelled=false;const calls:Request[]=[];return {calls,get cancelled(){return cancelled;},fetch:async(request:Request)=>{calls.push(request);let offset=0;return new Response(new ReadableStream({pull(controller){if(offset>=input.length){controller.close();return;}controller.enqueue(input.slice(offset,offset+chunks));offset+=chunks;},cancel(){cancelled=true;}}),{status,headers:{...(length?{'Content-Length':String(input.length)}:{}),ETag:etag,'Content-Type':'application/octet-stream'}});}};}
test('range streams only requested bytes across chunks and cancels the unused tail',async()=>{
 for(const range of ['bytes=0-7','bytes=11-44','bytes=98-120']){const assets=source(),response=await stateAsset(new Request(url,{headers:{Range:range}}),assets as unknown as Fetcher),[,a,b]=range.match(/bytes=(\d+)-(\d+)/)!.map(Number),end=Math.min(b,99);
  assert.equal(response.status,206);assert.equal(response.headers.get('Content-Range'),`bytes ${a}-${end}/100`);assert.equal(response.headers.get('Content-Length'),String(end-a+1));assert.deepEqual(new Uint8Array(await response.arrayBuffer()),input.slice(a,end+1));if(end<99)assert.equal(assets.cancelled,true);assert.equal(assets.calls[0].headers.has('Range'),false);
 }
});
test('invalid bounds, condition mismatch, missing length and non-success assets retain HTTP semantics',async()=>{
 for(const range of ['bytes=100-110','bytes=20-10','bytes=9007199254740992-9007199254740999']){const assets=source(),r=await stateAsset(new Request(url,{headers:{Range:range}}),assets as unknown as Fetcher);assert.equal(r.status,416);assert.equal(r.headers.get('Content-Range'),'bytes */100');assert.equal(assets.cancelled,true);}
 for(const headers of [{},{Range:'bytes=0-1,5-6'},{Range:'bytes=0-7','If-Range':'"old"'}] as Record<string,string>[]){const r=await stateAsset(new Request(url,{headers}),source() as unknown as Fetcher);assert.equal(r.status,200);assert.deepEqual(new Uint8Array(await r.arrayBuffer()),input);}
 for(const options of [{length:false},{status:404}]){const r=await stateAsset(new Request(url,{headers:{Range:'bytes=0-7'}}),source(options) as unknown as Fetcher);assert.equal(r.status,options.status??200);await r.arrayBuffer();}
});
