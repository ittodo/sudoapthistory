import test from 'node:test';
import assert from 'node:assert/strict';
import {regionModels,saleFrames,rentalFrames,packFrames} from './build-region-price-cache.mjs';
import {saleGroupFrames,rentalGroupFrames,priceBindings} from './region-price-groups.mjs';
const root=new URL('../',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'),ctx=regionModels(root),plain=x=>JSON.parse(JSON.stringify(x));
const catalog={complexes:[{id:'a',r:0},{id:'b',r:0},{id:'c',r:0}],areas:[[0,'84.12'],[1,'59.33'],[2,'84.12']]};
const payload={d:[{id:'merged',r:0,admin:['41','gu','dong'],memberSources:[{id:'a'},{id:'b'}]},{id:'c',r:0,admin:['41','gu','dong2']}]};
const shard={opening:[[0,20260801,100,100,100,1],[1,20260801,200,200,200,1],[2,20260801,800,800,800,1]],updates:[[0,20260902,300,300,300,1],[2,20260903,900,900,900,1]]};
const run=(p=payload,s=shard,previous=[],engine='e')=>saleGroupFrames(ctx,catalog,p,s,'2026-09',{previous,engine,calculate:saleFrames,pack:packFrames,province:0});
test('group contributions reproduce existing merged totals, ordering and representative ties',()=>{const result=run();assert.deepEqual(plain(result.frame),plain(saleFrames(ctx,catalog,payload,shard,'2026-09')));assert.equal(result.stats.computedGroups,2);});
test('unchanged, new unrelated complexes and display metadata reuse all existing groups',()=>{const first=run();const p=structuredClone(payload);p.d.push({id:'new',r:0,admin:['41','another']});p.d[0].n='renamed';p.d[0].coord=[0,0];p.d[0].tu=999;const result=run(p,shard,first.records);assert.equal(result.stats.computedGroups,0);assert.equal(result.stats.reusedGroups,2);assert.deepEqual(plain(first.frame),plain(result.frame));});
test('historical correction only recalculates the affected group',()=>{const first=run(),s=structuredClone(shard);s.updates[0][4]=400;const result=run(payload,s,first.records);assert.equal(result.stats.computedGroups,1);assert.equal(result.stats.reusedGroups,1);assert.deepEqual(plain(result.frame),plain(saleFrames(ctx,catalog,payload,s,'2026-09')));});
test('group change, corrupt receipts and engine change cannot reuse stale frames',()=>{const first=run();const p=structuredClone(payload);p.d[0].admin=['41','other'];assert.equal(run(p,shard,first.records).stats.computedGroups,1);const damaged=structuredClone(first.records);damaged[0].frame.opening.meta.count=999;assert.equal(run(payload,shard,damaged).stats.computedGroups,1);assert.equal(run(payload,shard,first.records,'new').stats.computedGroups,2);});
test('cross district or province approval is one group owned by the public complex',()=>{const c={complexes:[{id:'11110:1',r:0},{id:'28185:1',r:2}],areas:[[0,'84'],[1,'59']]},p={d:[{id:'approved',r:0,admin:['41','gu'],memberSources:[{id:'11110:1'},{id:'28185:1'}]}]},s={opening:[[0,20260801,100,100,100,1],[1,20260801,200,200,200,1]],updates:[]};for(const province of [0,2]){const r=saleGroupFrames(ctx,c,p,s,'2026-09',{engine:'e',calculate:saleFrames,pack:packFrames,province});assert.equal(r.frame.opening.meta.count,province===0?1:0);}});

test('rental group contributions preserve both rates, missing values and unmatched points',()=>{
 const c=[{id:'a',r:0,coord:[37,127],admin:['41','gu','dong']},{id:'b',r:0,coord:[37,127],admin:['41','gu']},{id:'c',r:0}];const row=(ci,date,rent,value,id,area='84')=>[ci,area,date,10000,rent,1,5,0,null,null,null,null,null,value,0,'2026-07',6,id];const s={opening:[row(0,20260801,10,60,'a'),row(1,20260801,20,null,'b'),row(2,20260801,30,80,'c')],updates:[row(0,20260902,40,90,'z'),row(0,20260902,50,100,'y','59')]};
 for(const type of ['monthly','jeonse']){const r=rentalGroupFrames(ctx,c,s,'2026-09','41',type,{engine:'e',calculate:rentalFrames,pack:packFrames});assert.deepEqual(plain(r.frame),plain(rentalFrames(ctx,c,s,'2026-09','41',type)));const warm=rentalGroupFrames(ctx,c,s,'2026-09','41',type,{engine:'e',calculate:rentalFrames,pack:packFrames,previous:r.records});assert.equal(warm.stats.computedGroups,0);}
});

test('new complex and exact area preserve old receipts; removal and month boundary match the model',()=>{
 const first=run(),c=structuredClone(catalog),p=structuredClone(payload),s=structuredClone(shard);
 c.complexes.push({id:'new',r:0});c.areas.push([3,'59.333333']);p.d.push({id:'new',r:0,admin:['41','other','other-dong']});s.updates.push([3,20260930,111,111,111,2]);
 const r=saleGroupFrames(ctx,c,p,s,'2026-09',{previous:first.records,engine:'e',calculate:saleFrames,pack:packFrames,province:0});
 assert.equal(r.stats.reusedGroups,2);assert.equal(r.stats.computedGroups,1);assert.deepEqual(plain(r.frame),plain(saleFrames(ctx,c,p,s,'2026-09')));
 const removed={opening:s.opening.filter(row=>row[0]!==2),updates:s.updates.filter(row=>row[0]!==2)};
 const x=saleGroupFrames(ctx,c,p,removed,'2026-09',{previous:r.records,engine:'e',calculate:saleFrames,pack:packFrames,province:0});assert.deepEqual(plain(x.frame),plain(saleFrames(ctx,c,p,removed,'2026-09')));
 const next={opening:s.opening,updates:[[3,20261001,200,200,200,1]]};const n=saleGroupFrames(ctx,c,p,next,'2026-10',{engine:'e',calculate:saleFrames,pack:packFrames,province:0});assert.deepEqual(plain(n.frame),plain(saleFrames(ctx,c,p,next,'2026-10')));
});

test('only this province adds raw update days to its monthly frame',()=>{
 const c=structuredClone(catalog);c.complexes.push({id:'foreign',r:1});c.areas.push([3,'84']);const s=structuredClone(shard);s.updates.push([3,20260915,100,100,100,1]);
 const r=saleGroupFrames(ctx,c,payload,s,'2026-09',{engine:'e',calculate:saleFrames,pack:packFrames,province:0});assert.deepEqual(plain(r.frame),plain(saleFrames(ctx,c,payload,shard,'2026-09')));
});

test('month binding excludes appended identities and display fields, but checks exact area and approvals',()=>{
 const refs=['0','1'],a=priceBindings('sale',catalog,payload,refs),c=structuredClone(catalog),p=structuredClone(payload);
 c.complexes.push({id:'new',r:0});c.areas.push([3,'20.0001']);p.d.push({id:'new',r:0});p.d[0].n='changed';p.d[0].coord=[1,2];p.d[0].tu=999;
 assert.deepEqual(priceBindings('sale',c,p,refs),a);c.areas[0][1]='84.1201';assert.notDeepEqual(priceBindings('sale',c,p,refs),a);c.areas[0][1]='84.12';p.d[0].memberSources=[{id:'a'}];assert.notDeepEqual(priceBindings('sale',c,p,refs),a);
 const rc=[{id:'one',r:0,coord:[1,2],admin:['41','gu','dong']},{id:'point',r:0,coord:[1,2],admin:['41','gu']}],before=priceBindings('rental',rc,payload,['0','1']);rc[0].n='irrelevant';rc[0].coord=[2,3];assert.deepEqual(priceBindings('rental',rc,payload,['0','1']),before);rc[1].n='point label changed';assert.notDeepEqual(priceBindings('rental',rc,payload,['0','1']),before);
});

test('unmatched rental point labels refresh without invalidating cached prices',()=>{
 const c=[{id:'a',r:0,n:'before',coord:[37,127],admin:['41','gu']}],row=[0,'84',20260801,100,10,1,5,0,null,null,null,null,null,150,0,'2026-07',6,'a'],s={opening:[row],updates:[]};
 const first=rentalGroupFrames(ctx,c,s,'2026-09','41','monthly',{engine:'e',calculate:rentalFrames,pack:packFrames});c[0].n='after';c[0].coord=[38,128];
 const next=rentalGroupFrames(ctx,c,s,'2026-09','41','monthly',{engine:'e',calculate:rentalFrames,pack:packFrames,previous:first.records});
 assert.equal(next.stats.computedGroups,0);assert.equal(next.stats.decoratedGroups,1);assert.deepEqual(plain(next.frame),plain(rentalFrames(ctx,c,s,'2026-09','41','monthly')));
});

test('incomplete rental unit receipt falls back to the original calculation',()=>{
 const c=[{id:'a',r:0,coord:[37,127],admin:['41','gu','dong']}],s={opening:[[0,'84',20260801,100,10,1,5,0,null,null,null,null,null,150,0,'2026-07',6,'a']],updates:[]};
 const options={engine:'e',calculate:rentalFrames,pack:packFrames},first=rentalGroupFrames(ctx,c,s,'2026-09','41','monthly',options),damaged=structuredClone(first.records);delete damaged[0].frame;
 const next=rentalGroupFrames(ctx,c,s,'2026-09','41','monthly',{...options,previous:damaged});assert.equal(next.stats.computedGroups,1);assert.deepEqual(plain(next.frame),plain(first.frame));
});


test('approved rental sources share one cache bundle but retain source weights and interleaved order',()=>{
 const c=[{id:'a',publicId:'approved',r:0,coord:[37,127],admin:['41','gu','dong']},{id:'other',r:0,coord:[37,127],admin:['41','gu','dong']},{id:'b',publicId:'approved',r:2,coord:[37,127],admin:['41','gu','dong']}];
 const row=(ci,value)=>[ci,'84.00001',20260801,100,10,1,5,0,null,null,null,null,null,value,0,'2026-07',6,String(ci)];
 const s={opening:[row(0,100.1),row(1,700.2),row(2,200.3)],updates:[]},options={engine:'e',calculate:rentalFrames,pack:packFrames};
 const first=rentalGroupFrames(ctx,c,s,'2026-09','41','monthly',options);
 assert.equal(first.records.length,2);assert.equal(first.records[0].frame.members.length,2);
 assert.deepEqual(plain(first.frame),plain(rentalFrames(ctx,c,s,'2026-09','41','monthly')));
 const warm=rentalGroupFrames(ctx,c,s,'2026-09','41','monthly',{...options,previous:first.records});assert.equal(warm.stats.computedGroups,0);
 const changed=structuredClone(s);changed.opening[2][13]=400;
 const next=rentalGroupFrames(ctx,c,changed,'2026-09','41','monthly',{...options,previous:first.records});assert.equal(next.stats.computedGroups,1);assert.equal(next.stats.reusedGroups,1);
 assert.deepEqual(plain(next.frame),plain(rentalFrames(ctx,c,changed,'2026-09','41','monthly')));
 c[2].publicId='other-approved';const linked=rentalGroupFrames(ctx,c,s,'2026-09','41','monthly',{...options,previous:first.records});assert.equal(linked.stats.computedGroups,2);
});

test('approved split, unlink and move drop stale groups and reuse the unrelated sale group',()=>{
 const first=run();
 const split=structuredClone(payload);split.d[0].memberSources=[{id:'a'}];split.d.push({id:'new-public',r:0,admin:['41','gu','dong'],memberSources:[{id:'b'}]});
 const r=run(split,shard,first.records);assert.equal(r.stats.computedGroups,2);assert.equal(r.stats.reusedGroups,1);assert.deepEqual(plain(r.frame),plain(saleFrames(ctx,catalog,split,shard,'2026-09')));
 const unlinked=structuredClone(split);unlinked.d=unlinked.d.filter(g=>g.id!=='new-public');const u=run(unlinked,shard,r.records);assert.equal(u.stats.reusedGroups,2);assert.ok(!u.records.some(g=>g.id==='new-public'));assert.deepEqual(plain(u.frame),plain(saleFrames(ctx,catalog,unlinked,shard,'2026-09')));
 const merged=structuredClone(split);merged.d=merged.d.filter(g=>g.id!=='merged');merged.d.find(g=>g.id==='new-public').memberSources.push({id:'a'});const m=run(merged,shard,r.records);assert.equal(m.stats.reusedGroups,1);assert.ok(!m.records.some(g=>g.id==='merged'));assert.deepEqual(plain(m.frame),plain(saleFrames(ctx,catalog,merged,shard,'2026-09')));
});
test('rental approval move and revocation refresh both owners without changing source weights',()=>{
 const c=[{id:'a',r:0,publicId:'old',coord:[37,127],admin:['41','gu','dong']},{id:'b',r:0,publicId:'old',coord:[37,127],admin:['41','gu','dong']},{id:'c',r:0,publicId:'unrelated',coord:[37,127],admin:['41','gu','dong']}];
 const row=(ci,value)=>[ci,'59.01',20260801,10000,10,1,5,0,null,null,null,null,null,value,0,'2026-07',6,String(ci)];const s={opening:[row(0,100),row(1,200),row(2,700)],updates:[]},opts={engine:'e',calculate:rentalFrames,pack:packFrames};
 const first=rentalGroupFrames(ctx,c,s,'2026-09','41','monthly',opts);c[1].publicId='new';const moved=rentalGroupFrames(ctx,c,s,'2026-09','41','monthly',{...opts,previous:first.records});assert.equal(moved.stats.computedGroups,2);assert.equal(moved.stats.reusedGroups,1);assert.deepEqual(plain(moved.frame),plain(rentalFrames(ctx,c,s,'2026-09','41','monthly')));
 c[1].publicId=null;const revoked=rentalGroupFrames(ctx,c,s,'2026-09','41','monthly',{...opts,previous:moved.records});assert.ok(!revoked.records.some(g=>g.id==='public:new'));assert.equal(revoked.stats.reusedGroups,2);assert.deepEqual(plain(revoked.frame),plain(rentalFrames(ctx,c,s,'2026-09','41','monthly')));
});
