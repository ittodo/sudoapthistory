const state={data:null,items:[],region:'',family:'',query:'',linkedOnly:false,sort:'name',selected:''};
const $=selector=>document.querySelector(selector);
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const number=value=>value==null?'없음':Number(value).toLocaleString('ko-KR');
const price=value=>value==null?'없음':`${Number(value).toLocaleString('ko-KR',{maximumFractionDigits:2})}만원`;
const date=value=>{const s=String(value||'');return /^\d{8}$/.test(s)?`${s.slice(0,4)}.${s.slice(4,6)}.${s.slice(6,8)}`:'없음'};
const address=value=>{try{const parsed=JSON.parse(value||'');return Array.isArray(parsed)?parsed.join(' · '):String(value||'')}catch{return String(value||'')}};
const latest=item=>Math.max(0,...item.transactions.flatMap(group=>group.areas.map(row=>Number(row.latestDate)||0)));

async function loadData(){
  if('DecompressionStream' in window){
    try{
      const response=await fetch('data/housing-v3/index.packed.bin?v=20260904');
      if(response.ok){
        const packed=new Uint8Array(await response.arrayBuffer());
        const magic=new TextEncoder().encode('HSGV3Z1\0');
        if(magic.every((value,index)=>packed[index]===value)){
          const stream=new Blob([packed.slice(magic.length)]).stream().pipeThrough(new DecompressionStream('deflate'));
          return JSON.parse(await new Response(stream).text());
        }
      }
    }catch(error){console.warn('공동주택 압축 데이터 fallback',error)}
  }
  const response=await fetch('data/housing-v3/index.json?v=20260904');
  if(!response.ok)throw new Error(`데이터 응답 ${response.status}`);
  return response.json();
}

function filtered(){
  const query=state.query.replace(/\s/g,'').toLowerCase();
  const rows=state.data.complexes.filter(item=>{
    if(state.region&&item.region!==state.region)return false;
    if(state.family&&item.housingFamily!==state.family)return false;
    if(state.linkedOnly&&!item.transactions.length)return false;
    if(query&&!`${item.name}${item.lotAddress}${item.roadAddress}${item.gu}${item.dong}`.replace(/\s/g,'').toLowerCase().includes(query))return false;
    return true;
  });
  rows.sort((a,b)=>state.sort==='units'?(Number(b.units)||0)-(Number(a.units)||0)||a.name.localeCompare(b.name,'ko'):state.sort==='recent'?latest(b)-latest(a)||a.name.localeCompare(b.name,'ko'):a.name.localeCompare(b.name,'ko'));
  return rows;
}

function renderList(){
  state.items=filtered();
  $('#resultCount').textContent=`${state.items.length.toLocaleString()}개`;
  $('#complexList').innerHTML=state.items.map(item=>`<button type="button" class="complex-row ${item.id===state.selected?'active':''}" data-k="${esc(item.id)}"><span><span class="complex-name">${esc(item.name)}</span><span class="complex-address">${esc(address(item.roadAddress)||item.lotAddress||`${item.gu} ${item.dong}`)}</span></span><span class="complex-meta">${number(item.units)}세대<br><span class="badge family-${item.housingFamily}">${item.housingFamily==='rowhouse'?'연립·다세대':'아파트'}</span></span></button>`).join('')||'<div class="empty-state">조건에 맞는 단지가 없습니다.</div>';
  $('#complexList').querySelectorAll('[data-k]').forEach(button=>button.addEventListener('click',()=>select(button.dataset.k)));
}

function select(code){
  state.selected=code;
  history.replaceState(null,'',`#k=${encodeURIComponent(code)}`);
  renderList();
  renderDetail(state.data.complexes.find(item=>item.id===code));
}

function renderDetail(item){
  if(!item){$('#detail').innerHTML='<div class="empty-state">목록에서 단지를 선택하세요.</div>';return}
  const groups=item.transactions.map(group=>`<div class="trade-group"><div class="trade-head"><div><strong>${esc(group.name)}</strong><br><small>${esc(group.key)}</small></div><small>${group.areas.length}개 면적</small></div><table class="area-table"><thead><tr><th>전용면적</th><th>최근가</th><th>거래량</th><th>최근 거래</th></tr></thead><tbody>${group.areas.map(row=>`<tr><td>${number(row.area)}㎡</td><td>${price(row.latestPrice)}</td><td>${number(row.volume)}건</td><td>${date(row.latestDate)}</td></tr>`).join('')}</tbody></table></div>`).join('');
  $('#detail').innerHTML=`<div class="detail-title"><div><h2>${esc(item.name)}</h2><div class="detail-address">${esc(item.lotAddress||'지번 주소 없음')}<br>${esc(address(item.roadAddress)||'도로명 주소 없음')}</div></div><span class="badge family-${item.housingFamily}">${item.housingFamily==='rowhouse'?'연립·다세대':'아파트'}</span></div><div class="facts"><div class="fact"><span>세대수</span><strong>${number(item.units)}</strong></div><div class="fact"><span>필지</span><strong>${number(item.parcels.length)}</strong></div><div class="fact"><span>건축물대장</span><strong>${number(item.registry.length)}</strong></div><div class="fact"><span>공개 단지 ID</span><strong>${esc(item.id)}</strong></div></div><h3>연결된 거래기록</h3>${groups||'<div class="notice">승인된 거래기록이 없습니다.</div>'}`;
}

function bind(){
  $('#search').addEventListener('input',event=>{state.query=event.target.value;renderList()});
  $('#linkedOnly').addEventListener('change',event=>{state.linkedOnly=event.target.checked;renderList()});
  $('#family').addEventListener('change',event=>{state.family=event.target.value;renderList()});
  $('#sort').addEventListener('change',event=>{state.sort=event.target.value;renderList()});
  $('#regions').querySelectorAll('[data-region]').forEach(button=>button.addEventListener('click',()=>{state.region=button.dataset.region;$('#regions .active')?.classList.remove('active');button.classList.add('active');renderList()}));
}

async function start(){
  bind();
  try{
    state.data=await loadData();
    const meta=state.data.meta;
    $('#summary').textContent=`사용자 승인 ${number(meta.publications)}개 · 아파트 ${number(meta.families.apartment)}개 · 연립·다세대 ${number(meta.families.rowhouse)}개`;
    renderList();
    const params=new URLSearchParams(location.hash.slice(1));
    const initial=params.get('k');
    if(initial&&state.data.complexes.some(item=>item.id===initial))select(initial);
  }catch(error){
    $('#summary').textContent='승인된 공동주택 데이터가 아직 준비되지 않았습니다.';
    $('#complexList').innerHTML=`<div class="empty-state">${esc(error.message)}</div>`;
  }
}
start();
