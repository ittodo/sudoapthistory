/* Rent records are joined only by the published canonical identity. */
(()=>{
 const esc=s=>NodoUI.escape(s), money=n=>n==null?'—':Number(n).toLocaleString('ko-KR')+'만원';
 let loading,reader,charts=[];
 function clear(){for(const c of charts)c.destroy();charts=[];}
 async function index(){if(!loading)loading=fetch('/data/apartment-rent/index.json').then(r=>{if(!r.ok)throw Error('전월세 자료를 불러오지 못했습니다.');return r.json();}).then(m=>{reader=createVerifiedDataClient('/',m.shards);return m;}).catch(e=>{loading=null;throw e;});return loading;}
 function months(period,now=new Date()) {const y=now.getFullYear(),m=now.getMonth();return Array.from({length:12},(_,i)=>{const d=period==='recent'?new Date(y,m-i,1):new Date(Number(period),11-i,1);return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}`;}).filter(x=>x<=`${y}${String(m+1).padStart(2,'0')}`).sort();}
 async function render({apartment,area,panel,current,script}){
  clear();const m=await index();if(!current())return;
  const ref=m.records[apartment.id];
  if(!ref){const codes=[apartment.id,...apartment.sources].map(x=>String(x).match(/^(\d{5})-/)?.[1]).filter(Boolean),known=codes.some(c=>m.coverage[c]);panel.innerHTML='<div class="nodo-status">'+(known?'수집된 기간에 이 단지의 전월세 거래가 없습니다.':codes.length?'이 지역의 전월세 자료는 아직 수집되지 않았습니다.':'이 단지의 전월세 연결이 아직 확인되지 않았습니다.')+'</div>';return;}
  const data=await reader('data/apartment-rent/'+ref.shard+'.json');if(!current())return;const rows=data[apartment.id].rows;
  const p=new URLSearchParams(location.search),years=[...new Set(Object.values(m.coverage).flatMap(x=>Object.keys(x)).map(x=>x.slice(0,4)))].sort().reverse();
  panel.innerHTML=`<div class="nodo-card"><h2>전월세 계약 내역</h2><div class="rent-filters"><label class="nodo-field">거래 유형<select id="rent-type"><option value="all">전체</option><option value="jeonse">전세</option><option value="monthly">월세</option></select></label><label class="nodo-field">기간<select id="rent-period"><option value="recent">최근 12개월</option>${years.map(y=>`<option value="${y}">${y}년</option>`).join('')}</select></label><label class="nodo-field">전용면적<select id="rent-area"><option value="all">전체 면적</option>${ref.areas.map(a=>`<option value="${a}">${a}㎡</option>`).join('')}</select></label></div><p id="rent-status" class="nodo-muted" role="status"></p><div class="rent-charts"><div><h3>전세·월세 보증금</h3><div class="nodo-chart"><canvas id="rent-deposit-chart"></canvas></div></div><div><h3>월세</h3><div class="nodo-chart"><canvas id="rent-monthly-chart"></canvas></div></div></div><p class="nodo-muted">같은 거래 유형·선택 면적의 월평균입니다. 해제 거래는 통계에서 제외하며, 거래가 없는 달은 연결하지 않습니다.</p><div class="nodo-table-wrap"><table class="nodo-table"><thead><tr><th>계약일</th><th>전용면적 · 층</th><th>유형</th><th>보증금</th><th>월세</th><th>계약 구분 · 기간</th><th>종전 보증금 · 월세</th><th>갱신권</th></tr></thead><tbody id="rent-rows"></tbody></table></div><button id="rent-more" class="nodo-button">더 보기</button></div>`;
  const $=id=>panel.querySelector('#'+id),type=$('rent-type'),period=$('rent-period'),size=$('rent-area');
  type.value=['all','jeonse','monthly'].includes(p.get('rentType'))?p.get('rentType'):'all';period.value=years.includes(p.get('rentPeriod'))?p.get('rentPeriod'):'recent';
  const sizeParam=p.get('rentArea');let rounded=!sizeParam&&area?Number(area.area):null;
  if(sizeParam&&[...size.options].some(o=>o.value===sizeParam))size.value=sizeParam;
  else if(rounded!=null){const matching=ref.areas.filter(a=>Math.round(a)===rounded);if(matching.length){size.add(new Option(rounded+'㎡ 평형 전체','group:'+rounded));size.value='group:'+rounded;}else rounded=null;}
  let limit=50,revision=0;
  const update=async()=>{const rev=++revision;clear();const requested=months(period.value),selected=rows.filter(r=>requested.includes(r.date.slice(0,7).replace('-',''))&&(type.value==='all'||r.category===type.value)&&(size.value==='all'||(size.value.startsWith('group:')?Math.round(r.area)===Number(size.value.slice(6)):String(r.area)===size.value)));
   const missing=requested.filter(x=>ref.districts.some(d=>!m.coverage[d]?.[x]));const stamp=ref.districts.flatMap(d=>Object.values(m.coverage[d]||{})).sort().at(-1);
   $('rent-status').textContent=`${selected.length.toLocaleString()}건 · 최근 확인 ${stamp?.slice(0,10)||'미확인'}${missing.length?' · 미수집 기간 '+missing.join(', '):''}`;
   $('rent-rows').innerHTML=selected.slice(0,limit).map(r=>`<tr${r.cancelled?' class="cancelled"':''}><td>${esc(r.date)}${r.cancelled?'<small>해제 '+esc(r.cancelDate)+'</small>':''}</td><td>${esc(r.area)}㎡ · ${esc(r.floor??'미확인')}층</td><td>${({jeonse:'전세',monthly:'월세'})[r.category]||'미확인'}</td><td>${money(r.deposit)}</td><td>${money(r.monthlyRent)}</td><td>${esc(r.contractType||'—')}<small>${esc(r.contractTerm)}</small></td><td>${money(r.previousDeposit)} / ${money(r.previousMonthlyRent)}</td><td>${esc(r.renewalRight||'—')}</td></tr>`).join('')||'<tr><td colspan="8">선택한 조건에 거래가 없습니다.</td></tr>';
   $('rent-more').hidden=limit>=selected.length;
   try{await script('https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js');if(!current()||rev!==revision)return;
    const average=(cat,key)=>requested.map(month=>{const rs=selected.filter(r=>!r.cancelled&&r.category===cat&&r.date.slice(0,7).replace('-','')===month&&r[key]!=null);return rs.length?rs.reduce((s,r)=>s+r[key],0)/rs.length:null;});
    const style=getComputedStyle(document.documentElement),muted=style.getPropertyValue('--muted').trim();
    for(const [id,sets] of [['rent-deposit-chart',[['전세 보증금','jeonse','deposit','#4589ed'],['월세 보증금','monthly','deposit','#20a38f']]],['rent-monthly-chart',[['월세','monthly','monthlyRent','#b978e8']]]])charts.push(new Chart($(id),{type:'line',data:{labels:requested.map(x=>x.slice(0,4)+'.'+x.slice(4)),datasets:sets.map(([label,c,k,color])=>({label,data:average(c,k),borderColor:color,spanGaps:false,pointRadius:3}))},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:muted}}},scales:{x:{ticks:{color:muted,maxTicksLimit:6}},y:{ticks:{color:muted,callback:v=>Number(v).toLocaleString()+'만'}}}}}));
   }catch{if(current())$('rent-status').textContent+=' · 차트를 불러오지 못했습니다. 아래 거래표를 확인하세요.';}
  };
  for(const select of [type,period,size])select.onchange=()=>{limit=50;const u=new URL(location.href);u.searchParams.set('rentType',type.value);u.searchParams.set('rentPeriod',period.value);u.searchParams.set('rentArea',size.value);history.pushState(null,'',u);update();};
  // Preserve grouped area selection in shared URLs as well.
  if(sizeParam?.startsWith('group:')&&ref.areas.some(a=>Math.round(a)===Number(sizeParam.slice(6)))){size.add(new Option(sizeParam.slice(6)+'㎡ 평형 전체',sizeParam));size.value=sizeParam;}
  $('rent-more').onclick=()=>{limit+=50;update();};await update();
 }
 window.NodoRent={render,clear,months};
})();
