import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../js/kapt-v2-app.js',import.meta.url),'utf8');
const item=(id,family='apartment',approved=false)=>({id,name:id,housingFamily:family,region:'서울',gu:'종로구',dong:'동',units:null,parcels:[],registry:[],transactions:[],review:{approved},publicationMode:'metadata_only',tenure:null});
async function open(data){
  const nodes=new Map(),requests=[],navigation=[];
  const node=selector=>{
    if(!nodes.has(selector))nodes.set(selector,{textContent:'',innerHTML:'',value:'',checked:false,addEventListener(){},querySelectorAll(){return[];},classList:{add(){},remove(){},toggle(){}}});
    return nodes.get(selector);
  };
  const context=vm.createContext({document:{querySelector:node},window:{addEventListener(){}},performance:{getEntriesByType:()=>[]},
    fetch:async path=>{requests.push(path);return {ok:true,json:async()=>data};},location:{hash:''},history:{replaceState(){}},URLSearchParams,
    NodoApartmentSearch:{bind:()=>({restore:async()=>{},checkScope(){},reportCount(){}})},NodoApartmentLinks:{go:(value,replace)=>navigation.push({value,replace})}});
  await vm.runInContext(source,context);
  return {nodes,requests,navigation,context};
}
test('current public roster without meta.families renders and does not invent approvals or rentals',async()=>{
  const data={meta:{contract:'current-review-publication-v1',candidateOnly:false,approvedOnly:false,publications:3},complexes:[item('a'),item('b','apartment',true),item('c','rowhouse')]};
  const view=await open(data);
  assert.equal(view.requests.length,1);
  assert.match(view.requests[0],/housing-v3\/index\.json/);
  assert.match(view.nodes.get('#summary').textContent,/공개 공동주택 3개 · 아파트 2개 · 연립·다세대 1개 · 개별 검토 승인 1개/);
  assert.doesNotMatch(view.nodes.get('#summary').textContent,/사용자 승인 3/);
  assert.equal(view.nodes.get('#resultCount').textContent,'3개');
  vm.runInContext('renderDetail(state.data.complexes[2])',view.context);
  assert.doesNotMatch(view.nodes.get('#detail').innerHTML,/임대 단지|승인된 거래/);
  assert.match(view.nodes.get('#detail').innerHTML,/연결된 거래기록이 없습니다/);
});
test('current exact-area summary unavailable remains unavailable and apartment aliases still navigate',async()=>{
  const apartment=item('canonical');apartment.legacyIds=['old-id'];
  const rowhouse=item('rowhouse','rowhouse');rowhouse.transactions=[{name:'원천',key:'source',areas:[],exactAreaSummaryStatus:'not_provided'}];
  const view=await open({meta:{contract:'current-review-publication-v1'},complexes:[apartment,rowhouse]});
  vm.runInContext('select("old-id")',view.context);
  assert.equal(view.navigation[0].value.id,'canonical');
  vm.runInContext('renderDetail(state.data.complexes[1])',view.context);
  assert.match(view.nodes.get('#detail').innerHTML,/면적별 거래 요약을 제공하지 않습니다/);
  assert.doesNotMatch(view.nodes.get('#detail').innerHTML,/<table|임대 단지/);
});
test('legacy approved JSON remains supported and preview metadata is rejected',async()=>{
  const legacy=await open({meta:{approvedOnly:true},complexes:[item('legacy')]});
  assert.match(legacy.nodes.get('#summary').textContent,/사용자 승인 1개/);
  const preview=await open({meta:{contract:'current-review-publication-v1',candidateOnly:true},complexes:[]});
  assert.match(preview.nodes.get('#complexList').innerHTML,/미리보기 자료/);
  assert.equal(preview.nodes.get('#resultCount'),undefined);
});
