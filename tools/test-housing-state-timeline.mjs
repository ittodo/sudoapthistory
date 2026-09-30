import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {packStateTimeline,openStateTimeline,encodeStateFile,decodeStateFile} from './housing-state-timeline.mjs';
const codec=await import(process.env.HOUSING_CODEC?pathToFileURL(process.env.HOUSING_CODEC):new URL('../js/generated/housing-columns.mjs',import.meta.url));
const a=['11110:0',20260101,1,3,2,2],b=['11110:1',20260102,2,4,3,2];
test('preserves repeated states, row order, retirement, return and empty months',()=>{
 const input={'2026-01':[a,b],'2026-02':[a,b],'2026-03':[b,a],'2026-04':[],'2026-05':[a]};
 const packed=packStateTimeline('11110','daily',input,codec),reader=openStateTimeline(packed,codec);
 assert.equal(packed.stats.uniqueStates,2);assert.equal(packed.stats.originalRows,7);
 for(const [m,rows]of Object.entries(input))assert.deepEqual(reader.month(m),rows);
 assert.throws(()=>reader.month('2026-06'));assert.deepEqual(packStateTimeline('11110','daily',input,codec).states,packed.states);
});
test('missing month does not become covered',()=>{const p=packStateTimeline('11110','daily',{'2026-01':[a],'2026-03':[a]},codec);assert.equal(p.stats.intervals,2);assert.throws(()=>openStateTimeline(p,codec).month('2026-02'));});
test('rental state retains all comparison values, nulls, rate month and duplicate rows',()=>{
 const r=['11110:0','59.12345',20260801,100,1.25,2,null,0,null,1.23456789,null,1,200,100.23456789,8,'2026-07',4.7,'ab'.repeat(10)];
 const input={'2026-08':[r,r],'2026-09':[r,r]};const p=packStateTimeline('11110','rental',input,codec);assert.equal(p.stats.uniqueStates,1);for(const m of Object.keys(input))assert.deepEqual(openStateTimeline(p,codec).month(m),input[m]);
});
test('invalid state ranges, regions, widths and coverage are rejected',()=>{
 assert.throws(()=>packStateTimeline('11111','daily',{'2026-01':[a]},codec));assert.throws(()=>packStateTimeline('11110','rental',{'2026-01':[a]},codec));
 const p=packStateTimeline('11110','daily',{'2026-01':[a]},codec);
 for(const rows of [[],[[24312,24312,0,0],[24312,24312,0,0]],[[24312,24313,0,0]],[[24312,24312,0,1]]])assert.throws(()=>openStateTimeline({...p,intervals:codec.encodeColumns(codec.schemas.StateInterval,rows)},codec));
});

test('self-contained file roundtrip rejects truncation, trailing bytes and wrong region',()=>{
 const input={'2026-01':[a,b],'2026-02':[a,b]},p=packStateTimeline('11110','daily',input,codec),bytes=encodeStateFile(p),scope={lawd:'11110',kind:'daily'};
 assert.deepEqual(decodeStateFile(bytes,codec,scope).month('2026-02'),input['2026-02']);
 assert.throws(()=>decodeStateFile(bytes.subarray(0,bytes.length-1),codec,scope));assert.throws(()=>decodeStateFile(new Uint8Array([...bytes,0]),codec,scope));assert.throws(()=>decodeStateFile(bytes,codec,{lawd:'11111',kind:'daily'}));
 assert.throws(()=>openStateTimeline({...p,counts:[0xffffffff,2]},codec));
});
