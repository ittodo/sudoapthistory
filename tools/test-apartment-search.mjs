import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {resolve} from 'node:path';
import {combineCatalogs,searchData,searchAssets} from './build-search-data.mjs';
import {createIndex,search,normalize,editDistance,highlights} from '../js/apartment-search-model.js';
import '../js/daily-model.js';
import '../js/rental-model.js';

const root=resolve(import.meta.dirname,'..');
const apt=(id,name,extra={})=>({id,name,aliases:[],r:1,g:'송파구',d:'잠실동',addresses:[],keys:[id],saleIds:[],rentalIds:[],mapIds:[],rows:[],...extra});
const index=items=>createIndex({schema:1,apartments:items});
test('unicode/case/spacing/brackets normalize without losing words or numbers',()=>{
  assert.equal(normalize('ＡＰＴ 리 센 츠 (2단지)'),normalize('apt리센츠2단지'));
  assert.equal(normalize('리센츠'.normalize('NFD')),normalize('리센츠'));
  assert.equal(normalize('ㄹㅅㅊ'),'ㄹㅅㅊ');
  assert.deepEqual(highlights('리 센 츠 (2단지)','리센츠'),[[0,5]]);
  for(const q of ['ㄹㅅㅊ','리ㅅㅊ','리센ㅊ'])assert.deepEqual(highlights('리 센 츠',q),[[0,5]],q);
});
test('rank exact alias, prefix, substring, initials, then bounded name typo',()=>{
  const i=index([apt('a','리센츠'),apt('b','리센츠파크'),apt('c','신리센츠'),apt('d','라센츠'),apt('e','별칭단지',{aliases:['리센츠']})]);
  assert.deepEqual(search(i,'리센츠').map(c=>c.id),['a','e','b','c','d']);
  for(const q of ['ㄹㅅㅊ','리ㅅㅊ','리센ㅊ','리센트'])assert.ok(search(i,q).some(c=>c.id==='a'),q);
  assert.ok(!search(index([apt('a','엘스')]),'엘수').length,'no typo expansion for two syllables');
  assert.equal(editDistance('abcdef','abxdef',1),1);
  assert.equal(editDistance('abcdef','xyzdef',1),Infinity);
});
test('every query word is required and place names cannot be fuzzy',()=>{
  const i=index([apt('a','리센츠'),apt('b','리센츠',{g:'서초구',d:'서초동'})]);
  assert.deepEqual(search(i,'잠실 리센츠').map(c=>c.id),['a']);
  assert.deepEqual(search(i,'리센츠 잠실').map(c=>c.id),['a']);
  assert.deepEqual(search(i,'잠실 리센트').map(c=>c.id),['a']);
  assert.deepEqual(search(i,'잠슬 리센츠'),[]);
  assert.deepEqual(search(i,'리센츠 xyz'),[]);
});
test('explicit building phase never crosses numbers; stable ordering and ten cap',()=>{
  const items=[apt('one','래미안1단지'),apt('two','래미안2단지'),apt('first','래미안1차'),apt('second','래미안2차')];
  assert.deepEqual(search(index(items),'래미안 1단지').map(c=>c.id),['one']);
  assert.deepEqual(search(index(items),'래미안 1차').map(c=>c.id),['first']);
  const duplicate=Array.from({length:15},(_,i)=>apt(String(i).padStart(2,'0'),'현대',{g:i%2?'강남구':'서초구'}));
  assert.equal(search(index(duplicate),'현대').length,10);
  assert.deepEqual(search(index(duplicate),'현대'),search(index([...duplicate].reverse()),'현대'));
  assert.ok(search(index(duplicate),'현대',{r:1,g:['강남구']}).every(c=>c.g==='강남구'));
  assert.deepEqual(search(index(duplicate),'현대',{r:0}),[]);
  assert.deepEqual(search(index(duplicate),''),[]);
});
test('only verified identities merge, areas deduplicate and rental-only sources survive',()=>{
  const base={r:1,g:'강남구',d:'역삼동',n:'같은이름'};
  const data=combineCatalogs({sale:[{...base,id:'11680-1',publicId:'confirmed'}],rental:[{...base,id:'11680-1',publicId:'confirmed'},{...base,id:'11680-2',g:'11680'}],rows:[{...base,as:'11680-1',i:1,a:59},{...base,as:'11680-1',i:2,a:84}],lookup:{'11680-1':['confirmed','aa']}});
  assert.equal(data.length,2);
  assert.deepEqual(data.find(c=>c.id==='confirmed').rows,[1,2]);
  const only=data.find(c=>c.id==='rental:11680-2');assert.equal(only.g,'강남구');assert.deepEqual(only.rentalIds,['11680-2']);
  assert.ok(!data.find(c=>c.id==='confirmed').keys.includes('11680-2'));
  const conflict=combineCatalogs({sale:[{...base,id:'11680-1',publicId:'claimed'},{...base,id:'11680-3',publicId:'claimed'}],ambiguous:['11680-1'],lookup:{claimed:['claimed','aa']}});
  assert.equal(conflict.length,2);assert.ok(conflict.some(c=>c.id==='11680-1'));
  const renamed=combineCatalogs({sale:[{...base,id:'11680-1',n:'이전 이름'}],rental:[{...base,id:'11680-1',publicId:'11680-1',n:'새 이름'}]});
  assert.deepEqual([renamed[0].name,...renamed[0].aliases].sort(),['새 이름','이전 이름']);
});
test('identity filters distinguish same names and still apply trade conditions',()=>{
  const c={id:'a',publicId:'pub-a',r:1,g:'강남구',d:'역삼동',n:'현대'};
  const t={c,a:84,p:100000,rent:0,area:84,deposit:100000};
  assert.equal(NodoDailyModel.match(t,{searchIds:['a'],q:'등록된별칭'}),true);
  assert.equal(NodoDailyModel.match({...t,c:{...c,id:'b',publicId:'pub-b'}},{searchIds:['a']}),false);
  assert.equal(NodoDailyModel.match(t,{searchIds:['a'],aH:60}),false);
  assert.equal(NodoRental.match(t,{type:'jeonse',searchIds:['a'],q:'등록된별칭'}),true);
  assert.equal(NodoRental.match({...t,c:{...c,id:'b',publicId:'pub-b'}},{type:'jeonse',searchIds:['a']}),false);
  assert.equal(NodoRental.match(t,{type:'jeonse',searchIds:['a'],depositMax:50000}),false);
  assert.equal(NodoRental.match({...t,c:{...c,id:'unconfirmed'}},{type:'jeonse',searchIds:['a','pub-a']}),false,'unconfirmed source cannot join via a conflicting public ID');
});
test('real catalog covers all areas and rental-only sources, with verifiable source hashes',()=>{
  const bytes=searchData(root),data=JSON.parse(bytes),i=createIndex(data);
  assert.ok(data.apartments.length>0);
  assert.equal(new Set(data.apartments.map(c=>c.id)).size,data.apartments.length);
  // Nightly collection changes catalog sizes; verify coverage against this build's inputs.
  for(const [path,field]of [['data/daily/catalog.bin','saleIds'],['data/rental/catalog.bin','rentalIds']]){
    const sources=JSON.parse(gunzipSync(readFileSync(resolve(root,path)))).complexes;
    const present=new Set(data.apartments.flatMap(c=>c[field]));
    for(const c of sources)assert.ok(present.has(c.id),'missing '+field+': '+c.id);
  }
  const rentalOnly=data.apartments.filter(c=>c.id.startsWith('rental:'));
  assert.ok(rentalOnly.every(c=>c.rentalIds.length>0&&c.saleIds.length===0));
  for(const [path,hash]of Object.entries(data.sources))assert.equal(createHash('sha256').update(readFileSync(resolve(root,path))).digest('hex'),hash);
  for(const query of ['리센츠','리 센 츠','ㄹㅅㅊ','리센ㅊ','리ㅅㅊ','잠실 리센츠'])assert.equal(search(i,query)[0].name,'리센츠',query);
  assert.ok(search(i,'리센트').some(c=>c.name==='리센츠'));
  assert.equal(search(i,'리센츠',{g:'강남구'}).length,0);
  assert.ok(search(i,'래미안 1단지').every(c=>[c.name,...c.aliases].some(n=>normalize(n).includes('1단지'))));
  assert.ok(data.apartments.every(c=>!/^\d{5}$/.test(c.g)));
  assert.equal(data.apartments.reduce((n,c)=>n+c.rows.length,0),JSON.parse(readFileSync(resolve(root,'data/index.json'))).d.length);
  assert.ok(!/"(?:trades|lastFive|previousPrice)"/.test(bytes.toString()));
  const assets=searchAssets(root);assert.ok(assets.some(f=>f.path==='js/apartment-search-worker.bundle.js'&&f.bytes.toString().includes('MIT')));
});
