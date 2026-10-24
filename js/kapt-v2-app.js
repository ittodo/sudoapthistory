import {loadHousingMetadata} from './housing-metadata.mjs';
let aptSearch;
const state={data:null,items:[],region:'',family:'',query:'',linkedOnly:false,sort:'name',selected:''};
const $=selector=>document.querySelector(selector);
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const number=value=>value==null?'없음':Number(value).toLocaleString('ko-KR');
const price=value=>value==null?'없음':`${Number(value).toLocaleString('ko-KR',{maximumFractionDigits:2})}만원`;
const date=value=>{const s=String(value||'');return /^\d{8}$/.test(s)?`${s.slice(0,4)}.${s.slice(4,6)}.${s.slice(6,8)}`:'없음'};
const address=value=>{try{const parsed=JSON.parse(value||'');return Array.isArray(parsed)?parsed.join(' · '):String(value||'')}catch{return String(value||'')}};
const latest=item=>Math.max(0,...item.transactions.flatMap(group=>group.areas.map(row=>Number(row.latestDate)||0)));
const rental=item=>item.tenure==='rental';
const currentPublication=()=>state.data?.meta?.contract==='current-review-publication-v1';

async function loadData(){
  const data=await loadHousingMetadata();
  if(data.meta?.candidateOnly===true)throw new Error('미리보기 자료는 공개 목록에서 표시하지 않습니다.');
  if(!Array.isArray(data.complexes))throw new Error('공동주택 목록 형식이 올바르지 않습니다.');
  if(data.meta?.contract&&data.meta.contract!=='current-review-publication-v1')throw new Error('지원하지 않는 공동주택 공개 형식입니다.');
  return data;
}

function filtered(){
  aptSearch?.checkScope();
  const query=state.query.replace(/\s/g,'').toLowerCase();
  const rows=state.data.complexes.filter(item=>{
    if(state.region&&item.region!==state.region)return false;
    if(state.family&&item.housingFamily!==state.family)return false;
    if(state.linkedOnly&&!item.transactions.length)return false;
    if(aptSearch?.selected&&!aptSearch.matches(item))return false;
    if(!aptSearch?.selected&&query&&!`${item.name}${item.lotAddress}${item.roadAddress}${item.gu}${item.dong}`.replace(/\s/g,'').toLowerCase().includes(query))return false;
    return true;
  });
  rows.sort((a,b)=>state.sort==='units'?(Number(b.units)||0)-(Number(a.units)||0)||a.name.localeCompare(b.name,'ko'):state.sort==='recent'?latest(b)-latest(a)||a.name.localeCompare(b.name,'ko'):a.name.localeCompare(b.name,'ko'));
  return rows;
}

function renderList(){
  state.items=filtered();
  aptSearch?.reportCount(state.items.length);
  $('#resultCount').textContent=`${state.items.length.toLocaleString()}개`;
  $('#complexList').innerHTML=state.items.map(item=>`<button type="button" class="complex-row ${item.id===state.selected?'active':''}" data-k="${esc(item.id)}"><span><span class="complex-name">${esc(item.name)}</span><span class="complex-address">${esc(address(item.roadAddress)||item.lotAddress||`${item.gu} ${item.dong}`)}</span></span><span class="complex-meta">${number(item.units)}세대<br><span class="badge family-${item.housingFamily}">${item.housingFamily==='rowhouse'?'연립·다세대':'아파트'}</span>${rental(item)?'<br><span class="badge rental">임대</span>':''}</span></button>`).join('')||'<div class="empty-state">조건에 맞는 단지가 없습니다.</div>';
  $('#complexList').querySelectorAll('[data-k]').forEach(button=>button.addEventListener('click',()=>select(button.dataset.k)));
}

function select(code,replace=false){
  const linked=state.data.complexes.find(value=>value.id===code||(value.legacyIds||[]).includes(code));
  if(linked?.housingFamily==='apartment'){saveSearch();NodoApartmentLinks.go({id:linked.id},replace);return;}
  const item=state.data.complexes.find(value=>value.id===code||(value.legacyIds||[]).includes(code));
  const canonical=item?.id||code;
  state.selected=canonical;
  history.replaceState(null,'',`#k=${encodeURIComponent(canonical)}`);
  renderList();
  renderDetail(item);
}

function renderDetail(item){
  if(!item){$('#detail').innerHTML='<div class="empty-state">목록에서 단지를 선택하세요.</div>';return}
  const groups=item.transactions.map(group=>`<div class="trade-group"><div class="trade-head"><div><strong>${esc(group.name)}</strong><br><small>${esc(group.key)}</small></div><small>${group.areas.length}개 면적</small></div>${group.areas.length?`<table class="area-table"><thead><tr><th>전용면적</th><th>최근가</th><th>거래량</th><th>최근 거래</th></tr></thead><tbody>${group.areas.map(row=>`<tr><td>${number(row.area)}㎡</td><td>${price(row.latestPrice)}</td><td>${number(row.volume)}건</td><td>${date(row.latestDate)}</td></tr>`).join('')}</tbody></table>`:'<div class="notice">이 목록에서는 면적별 거래 요약을 제공하지 않습니다.</div>'}</div>`).join('');
  const tradeSection=rental(item)?'<div class="rental-notice"><strong>임대 단지</strong><span>임대 단지로 확인되어 매매 실거래 통계를 제공하지 않습니다.</span></div>':`<h3>연결된 거래기록</h3>${groups||'<div class="notice">연결된 거래기록이 없습니다.</div>'}`;
  $('#detail').innerHTML=`<div class="detail-title"><div><h2>${esc(item.name)}</h2><div class="detail-address">${esc(item.lotAddress||'지번 주소 없음')}<br>${esc(address(item.roadAddress)||'도로명 주소 없음')}</div></div><div class="detail-badges"><span class="badge family-${item.housingFamily}">${item.housingFamily==='rowhouse'?'연립·다세대':'아파트'}</span>${rental(item)?'<span class="badge rental">임대</span>':''}</div></div><div class="facts"><div class="fact"><span>세대수</span><strong>${number(item.units)}</strong></div><div class="fact"><span>필지</span><strong>${number(item.parcels.length)}</strong></div><div class="fact"><span>건축물대장</span><strong>${number(item.registry.length)}</strong></div><div class="fact"><span>공개 단지 ID</span><strong>${esc(item.id)}</strong></div></div>${tradeSection}`;
}

function bind(){
  $('#search').addEventListener('input',event=>{state.query=event.target.value;renderList()});
  $('#linkedOnly').addEventListener('change',event=>{state.linkedOnly=event.target.checked;renderList()});
  $('#family').addEventListener('change',event=>{state.family=event.target.value;renderList()});
  $('#sort').addEventListener('change',event=>{state.sort=event.target.value;renderList()});
  $('#regions').querySelectorAll('[data-region]').forEach(button=>button.addEventListener('click',()=>{state.region=button.dataset.region;$('#regions .active')?.classList.remove('active');button.classList.add('active');renderList()}));
}

function saveSearch(){try{sessionStorage.setItem('nodo:kapt-search',JSON.stringify({region:state.region,family:state.family,query:state.query,linkedOnly:state.linkedOnly,sort:state.sort}));}catch{}}
window.addEventListener('pagehide',saveSearch);
async function start(){
  if(performance.getEntriesByType('navigation')[0]?.type==='back_forward'){
    try{const saved=JSON.parse(sessionStorage.getItem('nodo:kapt-search'));if(saved){for(const key of ['region','family','query','linkedOnly','sort'])if(Object.hasOwn(saved,key))state[key]=saved[key];$('#search').value=state.query;$('#family').value=state.family;$('#sort').value=state.sort;$('#linkedOnly').checked=state.linkedOnly;$('#regions').querySelectorAll('[data-region]').forEach(b=>b.classList.toggle('active',b.dataset.region===state.region));}}catch{}
  }

  bind();
  try{
    state.data=await loadData();
    const items=state.data.complexes;
    const families={apartment:items.filter(item=>item.housingFamily==='apartment').length,rowhouse:items.filter(item=>item.housingFamily==='rowhouse').length};
    const approved=items.filter(item=>item.review?.approved===true).length;
    const label=currentPublication()?'공개 공동주택':state.data.meta?.approvedOnly===true?'사용자 승인':'공개 공동주택';
    $('#summary').textContent=`${label} ${number(items.length)}개 · 아파트 ${number(families.apartment)}개 · 연립·다세대 ${number(families.rowhouse)}개${currentPublication()?` · 개별 검토 승인 ${number(approved)}개`:''}`;
    renderList();
    aptSearch=NodoApartmentSearch.bind($('#search'),{scope:()=>({r:({'서울':1,'경기':0,'인천':2})[state.region]??''}),enabled:()=>state.family!=='rowhouse',onSelect:c=>{state.query=c.name;renderList();},onClear:()=>{state.query=$('#search').value;renderList();}});
    await aptSearch.restore();
    const params=new URLSearchParams(location.hash.slice(1));
    const initial=params.get('k');
    if(initial&&state.data.complexes.some(item=>item.id===initial||(item.legacyIds||[]).includes(initial)))select(initial,true);
  }catch(error){
    $('#summary').textContent='공동주택 데이터를 불러오지 못했습니다.';
    $('#complexList').innerHTML=`<div class="empty-state">${esc(error.message)}</div>`;
  }
}
start();
