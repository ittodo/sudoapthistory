import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeRecords,openRecords,MAGIC} from '../js/packed-records.mjs';

test('indexed binary preserves nested metadata, exact numbers, nulls and member order',()=>{
 const value={name:'옥수동 🏠',fraction:59.123456789,zero:-0,absent:null,flag:true,off:false,empty:'',rows:[null,0,'001',[],{},[20260901,10000.25]],nested:JSON.parse('{"__proto__":{"safe":true},"constructor":"text"}')};
 const bytes=encodeRecords([['b',false],['a',value]]),reader=openRecords(bytes);
 assert.equal(new TextDecoder().decode(bytes.subarray(0,8)),MAGIC);assert.deepEqual(reader.keys(),['a','b']);assert.equal(reader.count,2);assert.deepEqual(reader.get('a'),value);assert.equal(reader.get('b'),false);assert.equal(reader.get('missing'),undefined);assert.equal({}.safe,undefined);
 assert.deepEqual(encodeRecords([['a',value],['b',false]]),bytes,'input entry order does not change the encoded bytes');
});
test('one lookup never constructs unrelated record values',()=>{
 const bytes=encodeRecords([['a',{value:1}],['b',{value:2}]]),reader=openRecords(bytes);
 const first=reader.get('a');first.value=99;assert.deepEqual(reader.get('b'),{value:2});assert.deepEqual(reader.get('a'),{value:1});
 assert.deepEqual(openRecords(encodeRecords([])).keys(),[]);
 const damaged=bytes.slice(),start=20+new DataView(damaged.buffer).getUint32(12,true),headerSize=new DataView(damaged.buffer).getUint32(start+8,true),header=JSON.parse(new TextDecoder().decode(damaged.subarray(start+12,start+12+headerSize)));
 damaged[start+12+headerSize+header.columns[0].values+2]=255; // Root of b; a stays valid.
 const selective=openRecords(new DataView(damaged.buffer));assert.deepEqual(selective.get('a'),{value:1});assert.throws(()=>selective.get('b'),/Invalid record node/);
});
test('invalid source values and damaged containers are rejected',()=>{
 for(const v of [undefined,NaN,Infinity,1n,new Date(),[undefined],'\ud800'])assert.throws(()=>encodeRecords([['a',v]]));
 const cyclic={};cyclic.self=cyclic;assert.throws(()=>encodeRecords([['a',cyclic]]),/Cyclic/);assert.throws(()=>encodeRecords([['a',1],['a',2]]),/Duplicate/);
 const good=encodeRecords([['a',{x:1}]]);assert.throws(()=>openRecords(good.subarray(0,19)));assert.throws(()=>openRecords(good.subarray(0,-1)));const bad=good.slice();bad[8]=2;assert.throws(()=>openRecords(bad));
});
