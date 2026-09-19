(async function() {
  'use strict';
  if(window.NodoRentalInitial)return;
  const M=NodoDailyModel,$=id=>document.getElementById(id),form=$('dailyFilters');
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=v=>v==null?'—':(v/10000).toLocaleString('ko-KR',{maximumFractionDigits:4})+'억';
  let client,day,period='day',span,filters={},kind='all',sort='price',token=0,limit=50,selected=[],chartRows=[];
  function districtOptions(){const g=form.elements.g.value;form.elements.g.innerHTML='<option value="">전체</option>'+[...new Set(client.catalog.complexes.filter(c=>form.elements.r.value===''||c.r===Number(form.elements.r.value)).map(c=>c.g))].sort().map(g=>`<option value="${esc(g)}">${esc(g)}</option>`).join('');form.elements.g.value=g;}
  function restore(){
    const p=new URLSearchParams(location.hash.slice(1));filters=M.filters(p);day=M.valid(p.get('date'))?p.get('date'):client.index.maxDate;
    day=day<client.index.minDate?client.index.minDate:day>client.index.maxDate?client.index.maxDate:day;
    period=['week','month'].includes(p.get('period'))?p.get('period'):'day';
    kind=['all','high','low','down','up','inactive'].includes(p.get('kind'))?p.get('kind'):'all';
    sort=['price','drop','rise','area'].includes(p.get('sort'))?p.get('sort'):kind==='down'?'drop':kind==='up'?'rise':'price';
    for(const k of ['r','q','aL','aH','pL','pH'])form.elements[k].value=filters[k]??'';
    districtOptions();form.elements.g.value=filters.g||'';$('dailySort').value=sort;load();
  }
  function save(){const p=new URLSearchParams({period,date:day,kind,sort});for(const [k,v]of Object.entries(filters))p.set(k,v);history.replaceState(null,'','#'+p);}
  const periodText=()=>span.from===span.to?span.from:span.from+' ~ '+span.to;
  function mapURL(t){const p=new URLSearchParams({mode:'price',date:t?M.iso(t.d):span.from,kind:kind==='inactive'?'all':kind,...filters});
    if(t){const c=t.c;p.set('a',c.mapId||c.id);if(c.coord){p.set('lat',c.coord[0]);p.set('lng',c.coord[1]);p.set('z',16);}}
    else if(period!=='day'){p.set('start',span.from);p.set('end',span.to);p.set('step','day');}
    return '/map/#'+p;
  }
  function render(){
    const s=M.summary(selected);$('dailyStats').innerHTML=[['유효 거래',s.count,'',`직거래 ${s.direct.toLocaleString()}건 포함`],['역대 신고가',s.high,'up','각 계약일 이전 역대 최고가 초과'],['직전 대비 상승',s.up,'up','직전 계약일 최고가격 초과'],['직전 대비 하락',s.down,'down','직전 계약일 최저가격 미만'],['역대 신저가',s.low,'down','각 계약일 이전 역대 최저가 미만'],['해제 거래',s.cancelled,'','선택 기간에 계약된 거래 중 해제'],['원천에서 사라짐',s.missing,'','해제 여부 미확인 · 유효 거래 제외']].map(([title,n,cls,note])=>`<article class="daily-stat ${cls}"><p>${title}</p><strong>${n.toLocaleString()}<small> 건</small></strong><small>${note}</small></article>`).join('');
    document.querySelectorAll('[data-kind]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.kind===kind)));
    const list=selected.filter(t=>M.category(t,kind));
    const rate=t=>M.changeRate(t)??(sort==='rise'?-Infinity:Infinity);
    list.sort((a,b)=>(sort==='drop'?(rate(a)-rate(b)):sort==='rise'?(rate(b)-rate(a)):sort==='area'?(a.a-b.a):b.p-a.p)||a.c.n.localeCompare(b.c.n)||a.id.localeCompare(b.id));
    const unlocated=M.summary(list).unlocated;
    $('dailyCount').textContent=`${periodText()} · ${list.length.toLocaleString()}건${unlocated?' · 이 목록 중 지도 위치 미확인 '+unlocated.toLocaleString()+'건':''}`;
    $('dailyMap').href=mapURL();$('dailyMap').textContent=(period==='day'?'이 날짜':'이 기간')+(kind==='inactive'?' 유효 거래 지도 ↗':' 지도에서 보기 ↗');
    $('dailyRows').innerHTML=list.length?list.slice(0,limit).map(t=>{
      const comparison=M.comparison(t),diff=comparison?.base==null?null:t.p-comparison.base,pct=M.changeRate(t);
      const annual=M.annualChange(t),annualText=annual?.rate==null?'계산 범위 초과':(annual.rate>0?'+':'')+annual.rate.toLocaleString('ko-KR',{notation:Math.abs(annual.rate)>=1000000?'scientific':'standard',maximumFractionDigits:2,minimumFractionDigits:2})+'%';
      const cls=diff<0?'daily-down':diff>0?'daily-up':'',label=M.badge(t);
      const detail=window.NodoApartmentLinks?.url({id:t.c.publicId,area:M.detailArea(t.a),tab:'trades'})||'/apartment/?'+new URLSearchParams({id:t.c.publicId,tab:'trades'});
      return `<article class="daily-row ${t.flags&6?'inactive':''}"><div><h3><a href="${esc(detail)}">${esc(t.c.n)}</a></h3><p>${['경기','서울','인천'][t.c.r]} ${esc(t.c.g)} ${esc(t.c.d)}</p><p>${t.a}㎡ · ${t.f==null?'층 미상':esc(t.f)+'층'}</p></div><div><strong class="daily-price">${money(t.p)}</strong><p><span class="daily-badge ${(t.records&1)||M.isUp(t)?'daily-up':t.records&6?'daily-down':''}">${esc(label)}</span></p></div><div><p>직전일 범위 ${money(t.previousMin)} ~ ${money(t.previousMax)}</p>${diff==null?(comparison?`<p>직전 범위 내 · 상승·하락 제외</p><p>${M.iso(t.previousDate)} → ${M.iso(t.d)}</p>`:'<p>비교 대상 없음 또는 판정 제외</p>'):`<p>${diff>0?'직전 최고가':'직전 최저가'} 대비</p><strong class="${cls}">${diff>0?'+':diff<0?'−':''}${money(Math.abs(diff))} (${pct>0?'+':''}${pct.toFixed(2)}%)</strong><p>${M.iso(t.previousDate)} → ${M.iso(t.d)}</p>${annual?`<p>${annual.days.toLocaleString()}일 경과 · 약 ${annual.years.toFixed(2)}년</p><strong class="${cls}">연환산 ${annualText}</strong>${annual.days<365?'<p>1년 미만 거래 간격 · 연환산 시 변동 확대</p>':''}`:''}`}<p>이전 최고 ${money(t.high)} / 최저 ${money(t.low)}</p></div><div><p>${M.iso(t.d)} 계약</p>${t.c.coord&&!(t.flags&6)?`<a class="daily-link" href="${esc(mapURL(t))}">지도에서 보기 ↗</a>`:'<p>지도 표시 대상 없음</p>'}<p><a href="${esc(detail)}">최신 단지 상세 ↗</a></p></div></article>`;
    }).join(''):'<div class="daily-empty">이 기간과 조건에 해당하는 거래가 없습니다.<br>다른 기간이나 거래 분류를 선택해 보세요.</div>';
    $('dailyMore').hidden=limit>=list.length;
    save();
  }
  function chart(){
    const byDate=new Map();for(const t of chartRows){const d=M.iso(t.d);if(!byDate.has(d))byDate.set(d,[]);byDate.get(d).push(t);}
    const first=period==='day'?M.shift(day,-29):span.start,last=period==='day'?day:span.end;
    const days=[];for(let d=first;d<=last;d=M.shift(d,1))days.push({d,...M.summary(byDate.get(d)||[])});
    $('dailyChartTitle').textContent=period==='day'?'최근 30일 거래 흐름':period==='week'?'선택 주의 일별 거래':'선택 월의 일별 거래';
    $('dailyChart').setAttribute('aria-label',$('dailyChartTitle').textContent);
    const max=Math.max(1,...days.map(d=>d.count));
    $('dailyChart').innerHTML=days.map(s=>`<button data-date="${s.d}" ${s.d===day?'aria-current="date"':''} ${s.d<client.index.minDate||s.d>client.index.maxDate?'disabled':''} aria-label="${s.d} ${s.d<client.index.minDate||s.d>client.index.maxDate?'보유 자료 없음':`전체 ${s.count}건 신고가 ${s.high}건 상승 ${s.up}건 하락 ${s.down}건`}" title="${s.d} · ${s.d<client.index.minDate||s.d>client.index.maxDate?'보유 자료 없음':`전체 ${s.count} · 신고가 ${s.high} · 상승 ${s.up} · 하락 ${s.down}`}"><span class="daily-bar-stack"><i style="height:${s.count/max*100}%"></i><i style="height:${s.high/max*100}%"></i><i style="height:${s.down/max*100}%"></i><i style="height:${s.up/max*100}%"></i></span><small>${s.d.slice(5).replace('-','.')}</small></button>`).join('');
  }
  async function load(){
    const request=++token;limit=50;selected=[];chartRows=[];span=M.periodRange(day,period,client.index.minDate,client.index.maxDate);
    $('dayDate').hidden=period!=='day';$('dayWeek').hidden=period!=='week';$('dayWeek').value=M.periodRange(day,'week').start;$('dayLabel').textContent={day:'계약일',week:'조회 주간',month:'조회 월'}[period];$('dayMonth').hidden=period!=='month';$('dayDate').value=day;$('dayMonth').value=day.slice(0,7);
    $('dayPrev').disabled=span.from<=client.index.minDate;$('dayNext').disabled=span.to>=client.index.maxDate;
    $('dayPrev').setAttribute('aria-label','이전 '+({day:'날짜',week:'주',month:'달'}[period]));$('dayNext').setAttribute('aria-label','다음 '+({day:'날짜',week:'주',month:'달'}[period]));
    document.querySelectorAll('[data-period]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.period===period)));
    $('dailyRecordRule').textContent=(period==='day'?'선택일':'선택 '+(period==='week'?'주간':'월간'))+'의 신고가·신저가는 각 계약일 이전의 역대 기록을 갱신한 거래 건수입니다. 기간 내 최고·최저 거래가와는 다르며, 같은 단지·면적도 다른 계약일에 기록을 다시 갱신하면 각각 집계합니다. 같은 날 거래끼리는 선후를 비교하지 않습니다.';
    $('dailyRange').textContent=periodText()+((span.start!==span.from||span.end!==span.to)?' · 보유 자료 범위까지만 집계':'');
    $('dailyStatus').textContent='계약일별 거래를 불러오는 중…';$('dailyRetry').hidden=true;$('dailyRows').innerHTML='';$('dailyStats').innerHTML='';$('dailyChart').innerHTML='';$('dailyCount').textContent='';$('dailyMore').hidden=true;
    try{
      const first=period==='day'?M.shift(day,-29):span.from,last=span.to,months=M.monthsBetween(first<client.index.minDate?client.index.minDate:first,last);
      const all=(await Promise.all(months.map(m=>client.trades(m,filters)))).flat();if(request!==token)return;
      chartRows=all.filter(t=>M.iso(t.d)>=first&&M.iso(t.d)<=last&&M.match(t,filters));selected=chartRows.filter(t=>t.d>=M.number(span.from)&&t.d<=M.number(span.to));
      render();chart();
      $('dailyStatus').textContent='계약일 기준 · 최근 날짜는 미신고 거래로 건수가 추가될 수 있습니다. 직거래는 가격 판정에서 제외합니다.';
    }catch(e){if(request!==token)return;$('dailyStatus').textContent=e.message;$('dailyRetry').hidden=false;}
  }
  function chooseDate(value){if(!M.valid(value)||value<client.index.minDate||value>client.index.maxDate){$('dailyStatus').textContent='조회 가능한 계약일을 선택해 주세요.';return;}day=value;load();}
  async function start(){
    try{client=await NodoDailyClient.create();$('dayDate').min=client.index.minDate;$('dayDate').max=client.index.maxDate;$('dayMonth').min=client.index.minDate.slice(0,7);$('dayMonth').max=client.index.maxDate.slice(0,7);
      $('dailyStamp').textContent=`보유 기간 ${client.index.minDate} ~ ${client.index.maxDate} · 갱신 ${new Date(client.index.updated).toLocaleString('ko-KR')} · 국토교통부 실거래가`;
      const weeks=[];for(let d=M.periodRange(client.index.minDate,'week').start;d<=client.index.maxDate;d=M.shift(d,1,'week'))weeks.push(`<option value="${d}">${d.replaceAll('-','.')} (월) ~ ${M.shift(d,6).replaceAll('-','.')} (일)</option>`);$('dayWeek').innerHTML=weeks.reverse().join('');
      restore();
    }catch(e){$('dailyStatus').textContent=e.message;$('dailyRetry').hidden=false;}
  }
  $('dailyRetry').onclick=()=>location.reload();
  $('dailyPeriods').onclick=e=>{const b=e.target.closest('[data-period]');if(!b||!client)return;period=b.dataset.period;load();};
  $('dayWeek').onchange=e=>{if(!client)return;chooseDate(e.target.value<client.index.minDate?client.index.minDate:e.target.value);};
  $('dayMonth').onchange=e=>{if(!client)return;const d=e.target.value+'-01';chooseDate(d<client.index.minDate?client.index.minDate:d);};
  $('dayDate').onchange=e=>client&&chooseDate(e.target.value);
  function move(n){if(!client)return;const next=M.shift(period==='month'?day.slice(0,7)+'-01':day,n,period);chooseDate(next<client.index.minDate?client.index.minDate:next>client.index.maxDate?client.index.maxDate:next);}
  $('dayPrev').onclick=()=>move(-1);$('dayNext').onclick=()=>move(1);$('dayLatest').onclick=()=>client&&chooseDate(client.index.maxDate);
  form.elements.r.onchange=()=>client&&districtOptions();
  form.onsubmit=e=>{e.preventDefault();if(!client)return;const p=new URLSearchParams(new FormData(form));for(const prefix of ['a','p']){const lo=p.get(prefix+'L'),hi=p.get(prefix+'H');if(lo!==''&&hi!==''&&Number(lo)>Number(hi)){$('dailyStatus').textContent='최솟값은 최댓값보다 클 수 없습니다.';return;}}filters=M.filters(p);load();};
  $('dailyReset').onclick=()=>{if(!client)return;form.reset();filters={};districtOptions();load();};
  document.querySelector('.daily-results .daily-tabs').onclick=e=>{const button=e.target.closest('[data-kind]');if(!button||!client)return;kind=button.dataset.kind;sort=kind==='down'?'drop':kind==='up'?'rise':'price';$('dailySort').value=sort;limit=50;render();};
  $('dailySort').onchange=e=>{if(!client)return;sort=e.target.value;render();};$('dailyMore').onclick=()=>{limit+=50;render();};
  $('dailyChart').onclick=e=>{const b=e.target.closest('[data-date]');if(b&&!b.disabled){period='day';chooseDate(b.dataset.date);}};
  window.addEventListener('hashchange',()=>client&&restore());window.addEventListener('popstate',()=>client&&restore());
  await start();
})();
