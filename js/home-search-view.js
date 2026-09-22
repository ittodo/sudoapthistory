/* Adapts the existing screener; does not create a second table or search controller. */
(()=>{
  let data,type='sale',states={},ready=false,restoring=false;
  const valid=t=>['sale','jeonse','monthly'].includes(t)?t:'sale',rental=()=>type!=='sale';
  const money=v=>v==null?'자료 없음':Number(v).toLocaleString('ko-KR',{maximumFractionDigits:2})+'만원';
  const record=x=>NodoHomeSearchModel.record(x,type,DI);
  function readType(){let saved;try{saved=JSON.parse(localStorage.getItem('nodo:rental:preferences:v1')||'{}').tenure;}catch{}return valid(new URLSearchParams(location.search).get('tenure')??saved);}
  function readStates(){try{const raw=new URLSearchParams(location.search).get('homePrices')||localStorage.getItem('nodo:home-prices:v1')||'{}',v=JSON.parse(raw);states={};for(const t of ['sale','jeonse','monthly'])if(v[t])states[t]={pL:String(v[t].pL||''),pH:String(v[t].pH||''),sc:['n','g','d','a','lp','ld','v','u','ls','c','m','s','ret'].includes(v[t].sc)?v[t].sc:'ld',sa:v[t].sa===true};}catch{states={};}}
  function remember(){if(!ready||restoring)return;states[type]={pL:gv('pL'),pH:gv('pH'),sc,sa};try{localStorage.setItem('nodo:home-prices:v1',JSON.stringify(states));}catch{}const u=new URL(location.href);u.searchParams.set('tenure',type);u.searchParams.set('homePrices',JSON.stringify(states));history.replaceState(history.state,'',u);}
  function useState(){const s=states[type]||{pL:'',pH:'',sc:'ld',sa:false};document.getElementById('pL').value=s.pL;document.getElementById('pH').value=s.pH;sc=rental()&&!['n','g','d','a','lp','ld','u'].includes(s.sc)?'ld':s.sc;sa=s.sa;}
  function sync(){
    document.body.dataset.homeTenure=type;
    document.querySelectorAll('#nodo-tenure button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tenure===type)));
    for(const id of ['cL','mL','sL','ryL'])document.getElementById(id)?.closest('div')?.classList.add('home-sale-filter');
    // Range controls have an inner wrapper: mark their grid cell, not just one input.
    for(const id of ['cL','mL','sL','ryL']){let e=document.getElementById(id);const grid=document.querySelector('#complexView > div > div');while(e&&e.parentElement!==grid)e=e.parentElement;e?.classList.add('home-sale-filter');}
    if(rental()){document.getElementById('priceFilterLabel').textContent=type==='jeonse'?'전세 보증금':'월 환산액';document.getElementById('priceFilterUnit').textContent='만원';document.getElementById('priceColumnLabel').textContent=type==='jeonse'?'최신 전세 보증금':'최신 월세';}
    document.getElementById('home-search-status').textContent=`보유 자료 최신 기준 · 매매 ${data.saleUpdated} · 전월세 ${data.manifest.asOf} · 거래 없는 단지도 포함`;
  }
  async function loadIndex(){
    data=await NodoHomeSearchData.load();const disk=NodoVerifiedDataCache.create('nodo-home-index-v1',2),bytes=await disk.download('data/index.json',data.manifest.inputs['data/index.json']);
    const j=normalizeIndexPayload(JSON.parse(new TextDecoder().decode(bytes)));data.saleUpdated=j.meta.updated;j.d=NodoHomeSearchModel.join(j.d,data.apartments,data.prices);return j;
  }
  async function install(){
    if(!document.querySelector('.nodo-header'))await new Promise(resolve=>document.addEventListener('DOMContentLoaded',resolve,{once:true}));
    const strip=document.createElement('div');strip.id='nodo-tenure';strip.innerHTML='<div role="group" aria-label="거래 유형">'+[['sale','매매'],['jeonse','전세'],['monthly','월세']].map(([t,n])=>`<button type="button" data-tenure="${t}" aria-pressed="false">${n}</button>`).join('')+'</div><span>아파트</span>';document.querySelector('.nodo-header').after(strip);
    const status=document.createElement('p');status.id='home-search-status';status.setAttribute('role','status');document.getElementById('complexView').prepend(status);
    type=readType();readStates();ready=true;sync();
    strip.onclick=e=>{const b=e.target.closest('[data-tenure]');if(!b||b.dataset.tenure===type)return;remember();const u=new URL(location.href);u.searchParams.set('tenure',b.dataset.tenure);u.searchParams.set('homePrices',JSON.stringify(states));history.pushState(history.state,'',u);type=b.dataset.tenure;useState();syncPriceMetricButtons();sync();af();try{const p=JSON.parse(localStorage.getItem('nodo:rental:preferences:v1')||'{}');p.tenure=type;localStorage.setItem('nodo:rental:preferences:v1',JSON.stringify(p));}catch{}};
    window.addEventListener('popstate',()=>{restoring=true;type=readType();readStates();for(const id of ['fR','fG','fD','fS','aL','aH','cL','cH','mL','mH','sL','sH','uL','uH','bL','bH'])document.getElementById(id).value='';selGus=[];renderGuChips();merged=false;const mergeButton=document.getElementById('mgBtn');mergeButton.textContent='평형별';mergeButton.style.background='';mergeButton.style.color='';mergeButton.style.borderColor='';includeInactive=false;retYearFrom=2024;retYearTo=2025;document.getElementById('ryL').value='2024';document.getElementById('ryH').value='2025';cp=1;sc='ld';sa=false;useState();syncPriceMetricButtons();sync();loadHash();homeAptSearch?.restore().then(()=>af());af();restoring=false;});
  }
  function price(x){if(!rental())return undefined;const t=record(x);return t?(type==='jeonse'?t.deposit:t.value):null;}
  function priceText(x){if(!rental())return x.lp==null?'거래 없음':null;const t=record(x);if(!t)return '거래 없음';return type==='jeonse'?money(t.deposit):`${t.value==null?"":"월 환산 "+money(t.value)+"<br>"}<small>${t.equivalent==null?"":"보증금 환산 "+money(t.equivalent)+"<br>"}보증금 ${money(t.deposit)} / 월세 ${money(t.rent)}</small>`;}
  function sortValue(x,key){if(!rental())return x[key];const t=record(x);return key==='lp'?price(x):key==='ld'?(t?Number(t.date.replaceAll('-','')):null):x[key];}
  function selection(x){const t=rental()?record(x):null;return {id:x._detailId||x._homeId||x.as,row:x._synthetic?null:x.i,area:x._merged?null:x.a,tab:rental()?'rent':'overview',tenure:type,rentType:rental()?type:undefined,rentArea:rental()&&!x._merged&&x.a!=null?'group:'+Math.round(x.a):undefined,rentPeriod:t?.date.slice(0,4)};}
  function decorate(){if(!ready)return;sync();if(rental()){const cards=document.querySelectorAll('#mobileCards .m-card');cards.forEach((c,i)=>{const t=record(F[(cp-1)*ps+i]);c.querySelector('.m-card-metrics').textContent=t?'최근 계약 '+t.date:'거래 없음';});}}
  window.NodoHomeSearchView={loadIndex,install,rental,price,priceText,sortValue,selection,decorate,remember,initialState:useState,date:x=>rental()?(record(x)?.date||'—'):null};
})();
