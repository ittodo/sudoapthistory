/* Shared rental workspace. Original sale views retain their own state and handlers. */
(async()=>{
 'use strict';
 const M=window.NodoRental,esc=window.NodoUI.escape,path=location.pathname.replace(/index\.html$/,'');
 const titles={'/':'단지 검색','/map/':'지도','/trades/':'실거래','/trades/daily/':'기간별 실거래','/apartment/':'단지 상세','/compare/':'지역·단지 비교','/ranking/':'순위','/stats/':'가격대 통계','/market/':'시장 동향'};
 if(!titles[path])return;
 const isDaily=path==='/trades/daily/';
 const key='nodo:rental:preferences:v1';let saved={};try{saved=JSON.parse(localStorage.getItem(key)||'{}');}catch{}
 const params=new URLSearchParams(location.search),initial=M.normalize(params,saved);
 if(path==='/map/'&&!params.has('rentConvert')&&saved.rentConvert==null)initial.convert=true;
 let settings={...initial,q:'',district:'',areaMin:'',areaMax:'',depositMin:'',depositMax:'',rentMin:'',rentMax:'',sort:'date',limit:50,map:path==='/map/',compactMap:true,detail:path==='/apartment/'?(params.get('id')||'__unresolved__'):null,year:''};
 for(const n of ['q','district','areaMin','areaMax','depositMin','depositMax','rentMin','rentMax','year','sort'])settings[n]=params.get('rental_'+n)??saved['rental_'+n]??settings[n];
 let worker,meta,ensuring,mapLayout,mapView,mapCreating,districtRegion,sliderTimer,renderedMapLabel,prefetchKey,playbackGeneration=0,seq=0,pending=new Map(),playing=false,timer,frame=0,map;
 const strip=document.createElement('div');strip.id='nodo-tenure';strip.innerHTML='<div role="group" aria-label="거래 유형">'+[['sale','매매'],['jeonse','전세'],['monthly','월세']].map(([v,n])=>`<button type="button" data-tenure="${v}" aria-pressed="false">${n}</button>`).join('')+'</div><span>아파트</span>';
 document.querySelector('.nodo-header').after(strip);
 // Apartment headers, tabs and contract tables are owned by the common detail view.
 if(path==='/apartment/'){
  const sync=()=>{const p=new URLSearchParams(location.search),type=p.get('tab')==='rent'?(p.get('rentType')||'all'):'sale';strip.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tenure===type)));};
  strip.onclick=e=>{const b=e.target.closest('[data-tenure]');if(!b)return;const u=new URL(location.href);u.searchParams.delete('tenure');u.searchParams.set('tab',b.dataset.tenure==='sale'?'trades':'rent');if(b.dataset.tenure!=='sale')u.searchParams.set('rentType',b.dataset.tenure);location.replace(u);};
  document.addEventListener('nodo:apartment-view',sync);document.addEventListener('change',sync);window.addEventListener('popstate',sync);sync();return;
 }
 const root=document.createElement('main');root.id='nodo-rental';root.hidden=true;strip.after(root);
 root.innerHTML=`<div class="rental-heading"><div><p class="rental-eyebrow">서울 · 경기 · 인천 아파트</p><h1 id="rental-title"></h1></div><label id="rental-convert-wrap"><input type="checkbox" id="rental-convert"> 월 환산액으로 비교</label></div>
 <form id="rental-filters" class="rental-card"><div class="rental-controls"><label>기간<select name="period"><option value="day">일별</option><option value="week">주별 · 월~일</option><option value="month">월별</option></select></label><label>계약일<input type="date" name="day"></label><label id="rental-year-wrap" hidden>조회 연도<select name="year"></select></label><label>지역<select name="region"><option value="">서울·경기·인천</option><option value="11">서울</option><option value="41">경기</option><option value="28">인천</option></select></label><label>시군구<select name="district"><option value="">전체</option></select></label><label>계약 구분<select name="contract"><option value="all">전체 · 구분별 판정</option><option value="1">신규</option><option value="2">갱신</option><option value="0">구분 미상</option></select></label><label>단지·지역 검색<input name="q" type="search" placeholder="단지명 또는 지역"></label></div>
 <details><summary>면적·보증금·월세 조건</summary><div class="rental-controls">${[['area','전용면적 (㎡)'],['deposit','보증금 (만원)'],['rent','월세 (만원)']].map(([k,n])=>`<label>${n}<span><input name="${k}Min" type="number" min="0" step="any" placeholder="최소"> ~ <input name="${k}Max" type="number" min="0" step="any" placeholder="최대"></span></label>`).join('')}</div></details><button type="submit" class="rental-primary">조회</button></form>
 <p id="rental-rate" class="rental-note"></p><p id="rental-status" role="status"></p><button id="rental-retry" hidden>다시 시도</button><p id="rental-coverage" class="rental-note"></p>
 <div id="rental-playback" class="rental-card" hidden><div class="rental-controls"><label>시작 월<input type="month" id="rental-start"></label><label>종료 월<input type="month" id="rental-end"></label><button id="rental-play" type="button" aria-pressed="false">▶ 재생</button><button id="rental-today" type="button">최근 계약일</button><label>간격<select id="rental-step"><option value="1">하루</option><option value="7">일주일</option><option value="month">한 달</option></select></label><label>속도<select id="rental-speed"><option value="1000">1배</option><option value="500">2배</option><option value="250">4배</option></select></label></div><input id="rental-slider" type="range" min="0" value="0" aria-label="표시 날짜"><p class="rental-note">선택일까지 마지막으로 확인된 거래 · 대표 거래의 보증금/월세 · 지도 위치가 확인된 단지만 표시</p></div>
 <section id="rental-map" hidden aria-label="전월세 지도"></section><section id="rental-stats" class="rental-stats" aria-label="거래 요약"></section>
 <section class="rental-card"><h2 id="rental-chart-title">선택 기간 계약 흐름</h2><div id="rental-chart"></div><p class="rental-note">신규·갱신·미상은 서로 다른 이력으로 비교합니다. 2021년 6월부터 임대차 신고 자료가 추가되어 이전과 거래량의 포착 범위가 다릅니다.</p></section>
 <section id="rental-trend-panel" class="rental-card" hidden><h2>전체 보유 기간 · 지역별 월평균</h2><p class="rental-note">시도·계약 구분 기준입니다. 아래 장기 추이는 단지·시군구·면적·금액 필터를 적용하지 않습니다. 환산율이 월별로 바뀌면 환산 추이에도 영향을 줍니다.</p><div id="rental-trend-graph"></div><div id="rental-trend"></div></section>
 <section id="rental-distribution-panel" class="rental-card" hidden><h2>선택 조건의 가격 분포</h2><div id="rental-distribution"></div></section>
 <section id="rental-regions-panel" class="rental-card" hidden><h2>지역 비교 · 계약 구분별 평균</h2><div id="rental-regions"></div></section>
 <section id="rental-rank-panel" class="rental-card" hidden><h2>단지·면적·계약 구분별 가격 순위</h2><div id="rental-rank"></div></section>
 <section class="rental-card"><div class="rental-controls"><h2>계약 내역</h2><label>분류<select id="rental-kind"><option value="all">전체 유효 거래</option><option value="up">직전 대비 상승</option><option value="down">직전 대비 하락</option><option value="within">직전 범위 내</option><option value="high">보유 이력 신고가</option><option value="low">보유 이력 신저가</option><option value="cancelled">해제 거래</option></select></label><label>정렬<select id="rental-sort"><option value="date">최근 계약일</option><option value="value">표시 가격 높은 순</option><option value="deposit">보증금 높은 순</option><option value="rent">월세 높은 순</option><option value="rise">상승률 큰 순</option><option value="drop">하락률 큰 순</option></select></label></div><p id="rental-count"></p><div id="rental-rows"></div><button id="rental-more" hidden>50건 더 보기</button></section>
 <details class="rental-card"><summary>전월세 가격 비교 기준</summary><p>전세는 보증금, 환산 월세는 월세＋보증금×연 환산율÷12로 비교합니다. 환산값은 실제 계약금액이나 법정 전환율을 뜻하지 않습니다.</p><p>같은 원천 단지·정확한 전용면적·전세/월세·신규/갱신/미상끼리 비교합니다. 직전 계약일 최고가를 넘으면 상승, 최저가보다 낮으면 하락이며 양 끝값을 포함한 사이는 범위 내입니다. 같은 날 거래의 순서는 추정하지 않습니다.</p><p>환산 비교에는 현재 거래의 계약 월 기준 환산율을 과거 비교 대상에도 동일하게 적용합니다. 공식 값이 아직 없으면 그 월 이전의 마지막 발표값을 사용하며 최초 공식 값 이전에는 환산하지 않습니다. 해제는 제외하고 첫 거래는 기록 갱신으로 세지 않습니다. 수집된 과거 이력이 추가되면 판정이 달라질 수 있습니다.</p></details>`;
 // Match the sale period page while retaining the shared rental form and data flow.
 if(isDaily){
  root.classList.add('daily-page','rental-daily-page');
  const heading=root.querySelector('.rental-heading');heading.classList.add('daily-heading');
  heading.querySelector('.rental-eyebrow').classList.add('daily-eyebrow');
  heading.querySelector('h1').after(Object.assign(document.createElement('p'),{className:'daily-muted',textContent:'일간·주간·월간 전월세 거래와 가격 변화를 살펴보세요.'}));
  heading.insertAdjacentHTML('beforeend','<a class="daily-link" id="rental-explorer" href="/trades/">기존 실거래 탐색기 ↗</a>');
  const f=root.querySelector('#rental-filters'), controls=f.querySelector('.rental-controls');f.classList.add('daily-panel','daily-controls');controls.classList.add('daily-filters');
  const period=f.elements.period.closest('label');period.hidden=true;
  const date=f.elements.day.closest('label');date.classList.add('rental-date-label');
  const year=f.elements.year.closest('label');year.hidden=true;
  const contract=f.elements.contract.closest('label');
  f.insertAdjacentHTML('afterbegin','<div class="daily-tabs daily-periods" id="rental-periods" role="group" aria-label="조회 단위">'+[['day','일간'],['week','주간'],['month','월간']].map(([v,n])=>`<button type="button" data-rental-period="${v}" aria-pressed="false">${n}</button>`).join('')+'</div><div class="daily-date" id="rental-date-nav"><button type="button" id="rental-prev" aria-label="이전 기간">←</button><button type="button" id="rental-next" aria-label="다음 기간">→</button><button type="button" id="rental-latest">최근</button></div><p id="rental-range" class="daily-muted" aria-live="polite"></p>');
  f.querySelector('#rental-next').before(date);date.insertAdjacentHTML('beforeend','<select id="rental-week" hidden aria-label="조회 주간 · 월요일부터 일요일"></select>');
  f.elements.region.options[0].textContent='수도권 전체';f.elements.district.closest('label').firstChild.textContent='시·군·구';
  f.elements.q.closest('label').classList.add('daily-search');f.elements.q.placeholder='단지명 또는 동 이름';
  for(const name of ['area','deposit','rent']){const label=f.elements[name+'Min'].closest('label');label.dataset.rentalAmount=name;controls.append(label);for(const edge of ['Min','Max'])f.elements[name+edge].setAttribute('aria-label',({'area':'전용면적','deposit':'보증금','rent':'월세'}[name])+(edge==='Min'?' 최소':' 최대'));}
  f.querySelector('details').remove();const submit=f.querySelector('[type=submit]');submit.classList.add('daily-primary');controls.append(submit);
  controls.insertAdjacentHTML('beforeend','<button type="button" id="rental-reset">초기화</button>');
  const extra=document.createElement('div');extra.className='rental-daily-extra';extra.append(contract,root.querySelector('#rental-convert-wrap'));f.append(extra,period,year);
  const kind=root.querySelector('#rental-kind');kind.closest('label').hidden=true;
  const resultPanel=kind.closest('section');resultPanel.insertAdjacentHTML('afterbegin','<div class="daily-section-heading rental-result-tabs"><div class="daily-tabs" id="rental-categories" role="group" aria-label="거래 분류">'+[...kind.options].map(o=>`<button type="button" data-rental-category="${o.value}" aria-pressed="false">${o.textContent.replace('전체 유효 거래','전체').replace('보유 이력 ','')}</button>`).join('')+'</div><a class="daily-link" id="rental-daily-map" href="/map/">이 날짜 지도에서 보기 ↗</a></div>');
  root.querySelector('#rental-stats').classList.add('daily-stats');
  root.querySelectorAll('.rental-card').forEach(e=>e.classList.add('daily-panel'));
 }
 const $=id=>document.getElementById(id),form=$('rental-filters'),money=v=>v==null?'—':Number(v).toLocaleString('ko-KR',{maximumFractionDigits:2})+'만원';
 if(settings.map){await script('/js/rental-map-layout.js?v=20260920-overlay1');mapLayout=window.NodoRentalMapLayout({root,form,settings,getMeta:()=>meta,refresh,stop});}
 if(!window.NodoDistrictPicker)await script('/js/district-picker.js?v=20260920-1');
 const districtPicker=window.NodoDistrictPicker(form.elements.district);
 const aptSearch=NodoApartmentSearch.bind(form.elements.q,{queryFromURL:()=>new URLSearchParams(location.search).get('rental_q')||'',scope:()=>({r:settings.region,g:settings.district}),enabled:()=>settings.type!=='sale'&&!settings.detail,onSelect:async c=>{stop();settings.q=c.name;settings.limit=50;await refresh();if(aptSearch.selected?.id!==c.id)return;if(settings.map&&map&&c.coord){map.setView(c.coord,16);drawMap();}},onClear:()=>{settings.q=form.elements.q.value;settings.limit=50;refresh();},onEdit:()=>{settings.searchIds=null;}});
 form.elements.district.onchange=()=>{stop();settings.district=form.elements.district.value;settings.limit=50;refresh();};
 const panels={daily:isDaily||path==='/apartment/',districts:['/market/','/compare/'].includes(path),rank:['/','/ranking/','/compare/'].includes(path),trend:['/market/','/compare/'].includes(path),histogram:path==='/stats/'};
 settings.panels=panels;
 const chartPanel=$('rental-chart').closest('section'),rowsPanel=$('rental-rows').closest('section');
 chartPanel.hidden=!panels.daily;
 if(!settings.map&&!isDaily){
  root.classList.add('rental-standard-page');
  root.dataset.rentalPage=path;
  const leading=path==='/stats/'?$('rental-distribution-panel'):path==='/market/'?$('rental-trend-panel'):path==='/compare/'?$('rental-regions-panel'):['/','/ranking/'].includes(path)?$('rental-rank-panel'):rowsPanel;
  $('rental-stats').after(leading);
  form.querySelector('.rental-controls').append(form.querySelector('[type=submit]'));
  form.insertAdjacentHTML('beforeend','<button type="button" id="rental-reset-filters">초기화</button>');
  $('rental-reset-filters').onclick=()=>{aptSearch.clear({notify:false});for(const k of ['q','district','region','areaMin','areaMax','depositMin','depositMax','rentMin','rentMax'])settings[k]='';settings.contract='all';settings.kind='all';settings.sort='date';settings.limit=50;refresh();};
  if(path==='/trades/'||path==='/market/'){
   const dateLabel=form.elements.day.closest('label'),nav=document.createElement('div');nav.className='rental-period-nav';
   dateLabel.before(nav);nav.append(dateLabel);
   for(const [direction,label]of [[-1,'이전 기간'],[1,'다음 기간']]){const button=document.createElement('button');button.type='button';button.textContent=direction<0?'←':'→';button.setAttribute('aria-label',label);button.dataset.shift=direction;button.onclick=()=>{settings.day=shiftPeriod(direction);settings.limit=50;refresh();};direction<0?nav.prepend(button):nav.append(button);}
  }
 }
 const typeName=()=>settings.type==='jeonse'?'전세':settings.convert?'월세 · 월 환산액':'월세 · 보증금/월세';
 const detailURL=t=>'/apartment/?'+new URLSearchParams({id:t.c?.publicId||t.publicId||t.c?.id||t.id,tab:'rent',rentType:settings.type,rentPeriod:(t.date||settings.day).slice(0,4),rentArea:String(t.area),area:String(Math.round(t.area)),view:'full'});
 function persist(){const values={tenure:settings.type,rentConvert:settings.convert?'1':'0',rentRegion:settings.region,rentContract:settings.contract,rentDate:settings.day,rentPeriod:settings.period,rentKind:settings.kind};for(const n of ['q','district','areaMin','areaMax','depositMin','depositMax','rentMin','rentMax','year','sort'])values['rental_'+n]=settings[n];try{localStorage.setItem(key,JSON.stringify(values));}catch{}const u=new URL(location.href);Object.entries(values).forEach(([k,v])=>u.searchParams.set(k,v));history.replaceState(null,'',u);}
 function sync(){
  M.cleanFilters(settings,meta?.districtsByRegion);
  if(meta&&districtRegion!==settings.region){const names=settings.region?meta.districtsByRegion[settings.region]:[...new Set(Object.values(meta.districtsByRegion).flat())].sort((a,b)=>a.localeCompare(b,'ko'));districtPicker.setOptions(names,settings.district);districtRegion=settings.region;}
  districtPicker.setValue(settings.district);
  form.elements.rentMin.closest('label').hidden=settings.type!=='monthly';
  for(const b of root.querySelectorAll('[data-shift]'))b.disabled=!meta||(Number(b.dataset.shift)<0?M.range(shiftPeriod(-1),settings.period).to<meta.months[0]+'-01':shiftPeriod(1)>meta.lastDate);
  root.classList.toggle('rental-map-page',settings.map);strip.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tenure===settings.type)));root.hidden=settings.type==='sale';document.body.classList.toggle('rental-active',settings.type!=='sale');$('rental-title').textContent=(settings.type==='monthly'?'월세':'전세')+' '+titles[path]+(settings.detail&&meta?.detail?' · '+meta.detail.n:'');$('rental-convert-wrap').hidden=settings.type!=='monthly';$('rental-convert').checked=settings.convert;
  for(const [k,v]of Object.entries(settings))if(k!=='day'&&form.elements[k])form.elements[k].value=v;const dayInput=form.elements.day;dayInput.type=settings.period==='month'&&!settings.map?'month':'date';dayInput.value=dayInput.type==='month'?settings.day.slice(0,7):settings.day;dayInput.previousSibling.textContent=settings.map?'표시일':settings.period==='month'?'계약 월':settings.period==='week'?'주간 선택 · 월~일':'계약일';if(meta){dayInput.min=meta.months[0]+(dayInput.type==='month'?'':'-01');dayInput.max=dayInput.type==='month'?meta.lastDate.slice(0,7):meta.lastDate;}
  const raw=settings.type==='monthly'&&!settings.convert;for(const o of $('rental-kind').options)o.disabled=raw&&!['all','cancelled'].includes(o.value);for(const o of $('rental-sort').options)o.disabled=raw&&['rise','drop'].includes(o.value);$('rental-kind').value=settings.kind;$('rental-sort').value=settings.sort;
  if(!mapLayout)$('rental-playback').hidden=!settings.map;$('rental-map').hidden=!settings.map;$('rental-year-wrap').hidden=!settings.detail;
  for(const n of ['day','period'])form.elements[n].closest('label').hidden=!!settings.detail||(n==='period'&&settings.map);form.elements.day.readOnly=settings.map;
  if(isDaily)syncDaily();if(mapLayout)mapLayout.sync();
  $('rental-trend-panel').hidden=!['/market/','/compare/'].includes(path);$('rental-regions-panel').hidden=!['/market/','/compare/'].includes(path);$('rental-rank-panel').hidden=!['/','/ranking/','/compare/'].includes(path);$('rental-distribution-panel').hidden=path!=='/stats/';
 }
 function shiftPeriod(direction){const span=M.range(settings.day,settings.period),d=new Date(span.from+'T00:00:00Z');if(settings.period==='month')d.setUTCMonth(d.getUTCMonth()+direction);else d.setUTCDate(d.getUTCDate()+direction*(settings.period==='week'?7:1));return d.toISOString().slice(0,10);}
 function syncDaily(){
  if(settings.type!=='monthly'){settings.rentMin=settings.rentMax='';form.elements.rentMin.value=form.elements.rentMax.value='';}
  if(settings.type==='monthly'&&!settings.convert&&!['all','cancelled'].includes(settings.kind))settings.kind='all';
  $('rental-date-nav').dataset.period=settings.period;
  root.querySelectorAll('[data-rental-category]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.rentalCategory===settings.kind));b.disabled=settings.type==='monthly'&&!settings.convert&&!['all','cancelled'].includes(b.dataset.rentalCategory);});
  $('rental-daily-map').href='/map/?'+new URLSearchParams({...NodoApartmentSearch.params(),tenure:settings.type,rentConvert:settings.convert?'1':'0',rentDate:settings.day,rentRegion:settings.region,rentContract:settings.contract,rental_district:settings.district});
  $('rental-title').textContent='기간별 실거래';root.querySelector('.rental-eyebrow').textContent='TRANSACTIONS · 수도권 아파트 '+(settings.type==='monthly'?'월세':'전세');
  $('rental-explorer').href='/trades/?'+new URLSearchParams({tenure:settings.type,rentConvert:settings.convert?'1':'0'});
  form.elements.period.closest('label').hidden=true;
  root.querySelector('[data-rental-amount="rent"]').hidden=settings.type!=='monthly';
  root.querySelectorAll('[data-rental-period]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.rentalPeriod===settings.period)));
  const week=$('rental-week');week.hidden=settings.period!=='week';form.elements.day.hidden=settings.period==='week';
  $('rental-prev').disabled=!meta;$('rental-next').disabled=!meta;
  if(!meta||!settings.day)return;
  const span=M.range(settings.day,settings.period);$('rental-range').textContent=span.from===span.to?span.from:span.from+' ~ '+span.to+(settings.period==='week'?' · 월요일~일요일':'');
  $('rental-prev').disabled=M.range(shiftPeriod(-1),settings.period).to<meta.months[0]+'-01';$('rental-next').disabled=shiftPeriod(1)>meta.lastDate;
  if(settings.period==='week'){
   if(!week.options.length){let day=M.range(meta.months[0]+'-01','week').from;const options=[];while(day<=meta.lastDate){const r=M.range(day,'week');options.push(`<option value="${day}">${r.from} ~ ${r.to}</option>`);const d=new Date(day+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+7);day=d.toISOString().slice(0,10);}week.innerHTML=options.reverse().join('');}
   week.value=span.from;
  }
 }
 if(isDaily){
  $('rental-categories').onclick=e=>{const b=e.target.closest('[data-rental-category]');if(!b||b.disabled)return;settings.kind=b.dataset.rentalCategory;settings.limit=50;refresh();};
  $('rental-periods').onclick=e=>{const b=e.target.closest('[data-rental-period]');if(!b)return;settings.period=b.dataset.rentalPeriod;settings.limit=50;refresh();};
  for(const [id,direction]of [['rental-prev',-1],['rental-next',1]])$(id).onclick=()=>{if(!meta)return;settings.day=shiftPeriod(direction);settings.limit=50;refresh();};
  $('rental-latest').onclick=()=>{if(!meta)return;settings.day=meta.lastDate;settings.limit=50;refresh();};
  $('rental-week').onchange=e=>{settings.day=e.target.value;settings.limit=50;refresh();};
  form.elements.day.onchange=e=>{if(!e.target.value)return;settings.day=e.target.value.length===7?e.target.value+'-01':e.target.value;settings.limit=50;refresh();};
  $('rental-reset').onclick=()=>{aptSearch.clear({notify:false});for(const k of ['q','district','region','areaMin','areaMax','depositMin','depositMax','rentMin','rentMax'])settings[k]='';settings.contract='all';settings.kind='all';settings.sort='date';settings.limit=50;refresh();};
 }
 function request(action,extras={}){if(!worker){worker=new Worker('/js/rental-worker.js?v=20260922-regions1');worker.onmessage=({data})=>{const p=pending.get(data.id);if(!p)return;pending.delete(data.id);data.error?p.reject(Error(data.error)):p.resolve(data);};worker.onerror=()=>{for(const p of pending.values())p.reject(Error('전월세 계산을 시작하지 못했습니다. 새로고침해 주세요.'));pending.clear();};}const id=++seq;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});worker.postMessage({id,action,...extras});});}
 async function ensure(){if(meta)return;if(ensuring)return ensuring;ensuring=initialize();try{await ensuring;}finally{ensuring=null;}}
 async function initialize(){
  if(settings.detail&&params.has('row')&&!params.has('id')){const response=await fetch('/data/apartments/index.json');if(!response.ok)throw Error('단지 정보를 불러오지 못했습니다.');const index=await response.json();settings.detail=index.legacy?.[params.get('row')]?.[0]||'__unresolved__';}
  const init=await request('init',{settings:{detail:settings.detail,map:settings.map}});meta=init.meta;settings.district=settings.district.split(',').map(n=>init.districtNames[n]||n).join(',');const last=meta.months.at(-1);if(!settings.day)settings.day=meta.lastDate;if(!/^\d{4}-\d{2}-\d{2}$/.test(settings.day)||settings.day>meta.lastDate)settings.day=meta.lastDate;if(settings.day<meta.months[0]+'-01')settings.day=meta.months[0]+'-01';settings.year=settings.year||last.slice(0,4);if(settings.map)$('rental-coverage').textContent='자료 보유 기간 '+meta.months[0]+' ~ '+meta.lastDate+' · 일부 지역·단지의 과거 이력은 추가 수집 중';form.elements.day.min=meta.months[0]+'-01';form.elements.day.max=meta.lastDate;form.elements.year.innerHTML=[...meta.historyYears].reverse().map(y=>`<option>${y}</option>`).join('');districtPicker.setOptions(init.districts,settings.district);const h=new URLSearchParams(location.hash.slice(1)),clampMonth=v=>/^\d{4}-\d{2}$/.test(v||'')?[meta.months[0],v,last].sort()[1]:null;$('rental-start').value=clampMonth(h.get('start')?.slice(0,7))||settings.day.slice(0,7);$('rental-end').value=clampMonth(h.get('end')?.slice(0,7))||last;if($('rental-start').value>$('rental-end').value)$('rental-end').value=$('rental-start').value;if(['1','7','month'].includes(h.get('step')))$('rental-step').value=h.get('step');if(['1','2','4'].includes(h.get('speed')))$('rental-speed').value=String(1000/Number(h.get('speed')));}
 function rateText(){if(settings.type!=='monthly'){ $('rental-rate').textContent='전세 보증금 기준 · 보유 이력 범위에서 비교';return;}const regions=settings.region?[settings.region]:M.REGIONS;const rates=regions.map(r=>{const a=M.rateFor(meta.rates,r,settings.day.slice(0,7));return ({'11':'서울','41':'경기','28':'인천'}[r])+': '+(a?`연 ${a.value}% (${a.month} 기준)`:'공식 값 없음');});$('rental-rate').innerHTML=(settings.convert?'월 환산액 적용 · ':'환산을 켜면 적용 · ')+rates.map(esc).join(' / ')+` · <a href="${esc(meta.rates.source)}" target="_blank" rel="noopener">한국부동산원 공식 통계</a><br>과거 거래 내역에는 각 계약 월의 적용값을 별도로 표시합니다.`;}
 function stop(){playbackGeneration++;if(prefetchKey&&worker)request('cancel-prefetch').catch(()=>{});prefetchKey=null;if($('rental-buffer'))$('rental-buffer').hidden=true;clearTimeout(sliderTimer);playing=false;clearTimeout(timer);$('rental-play').textContent='▶ 재생';$('rental-play').setAttribute('aria-pressed','false');}
 function warmNextMonth(){
  if(!playing||!settings.map||!meta)return;
  const endMonth=[$('rental-end').value,meta.lastDate.slice(0,7)].sort()[0],key=settings.type+':'+settings.region+':'+settings.day.slice(0,7)+':'+endMonth;
  if(prefetchKey===key)return;prefetchKey=key;
  const buffer=$('rental-buffer');buffer.hidden=settings.day.slice(0,7)>=endMonth;buffer.textContent='다음 달 자료를 미리 준비하는 중…';
  request('prefetch',{settings:{map:true,zoom:map?.getZoom(),type:settings.type,day:settings.day,region:settings.region,endMonth}}).then(result=>{
   if(!playing||prefetchKey!==key||result.cancelled)return;
   buffer.hidden=!result.prefetched&&!result.failed;buffer.textContent=result.failed?'다음 달 자료는 이동할 때 다시 불러옵니다.':'다음 달 자료 준비 완료';
  }).catch(()=>{if(playing&&prefetchKey===key)buffer.textContent='다음 달 자료는 이동할 때 다시 불러옵니다.';});
 }
 async function refresh(){const id=++frame;try{
  aptSearch.checkScope();settings.searchIds=aptSearch.ids;
  if(settings.map&&mapView?.beginView())renderedMapLabel=null;
  sync();if(settings.type==='sale'){stop();return;}
  root.setAttribute('aria-busy','true');$('rental-status').textContent='전월세 자료를 불러오는 중…'+(settings.map&&renderedMapLabel?' · 지도는 '+renderedMapLabel+' 기준':'');$('rental-retry').hidden=true;
  await Promise.all([ensure(),settings.map&&!map?renderMap([],[],id):Promise.resolve()]);if(id!==frame)return;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(settings.day))settings.day=meta.lastDate;
  settings.day=[meta.months[0]+'-01',settings.day,meta.lastDate].sort()[1];sync();rateText();
  if(settings.map&&map){const b=map.getBounds().pad(.12);settings.zoom=map.getZoom();settings.bounds={south:b.getSouth(),north:b.getNorth(),west:b.getWest(),east:b.getEast()};}
  const result=await request('view',{settings});if(id!==frame||result.stale)return;
  if(settings.map){await renderMap(result.points,result.regionSummaries,id);if(id!==frame)return;renderedMapLabel=typeName()+' '+settings.day;syncSlider();}else render(result);
  if(id!==frame)return;
  $('rental-status').textContent='자료 확인 완료 · '+(settings.map?settings.day+'까지의 마지막 거래 · '+result.count.toLocaleString()+'건 · 위치 미확인 '+result.stats.unlocated.toLocaleString()+'건':settings.detail?settings.year+'년':M.range(settings.day,settings.period).from+' ~ '+M.range(settings.day,settings.period).to);
  aptSearch.reportCount(result.count);persist();warmNextMonth();
 }catch(e){if(id!==frame)return;stop();$('rental-rows').textContent='조회하지 못했습니다. 다시 시도해 주세요.';$('rental-stats').replaceChildren();$('rental-status').textContent=e.message+(settings.map&&renderedMapLabel?' · 지도는 '+renderedMapLabel+' 기준':'');$('rental-retry').hidden=false;}finally{if(id===frame)root.setAttribute('aria-busy','false');}}
 function syncSlider(){if(settings.day.slice(0,7)<$('rental-start').value)$('rental-start').value=settings.day.slice(0,7);if(settings.day.slice(0,7)>$('rental-end').value)$('rental-end').value=settings.day.slice(0,7);const start=new Date($('rental-start').value+'-01T00:00:00Z'),end=new Date($('rental-end').value+'-01T00:00:00Z');end.setUTCMonth(end.getUTCMonth()+1);end.setUTCDate(0);const max=meta?Math.min(+end,Date.parse(meta.lastDate)):+end;$('rental-slider').max=Math.max(0,(max-start)/86400000);$('rental-slider').value=Math.max(0,(Date.parse(settings.day)-start)/86400000);if(mapLayout)mapLayout.sync();}

 function render(result){
  const s=result.stats,raw=settings.type==='monthly'&&!settings.convert;const cards=[[settings.map?'마지막 거래 이력':'유효 거래',s.count],['해제',s.cancelled],['지도 위치 미확인',s.unlocated]];if(!raw)cards.splice(1,0,['직전 대비 상승',s.up],['직전 대비 하락',s.down],['직전 범위 내',s.within],['보유 이력 신고가',s.high],['보유 이력 신저가',s.low]);$('rental-stats').innerHTML=cards.map(([n,v])=>`<article class="${isDaily?'daily-stat '+(/상승|신고가/.test(n)?'up':/하락|신저가/.test(n)?'down':''):''}"><span>${n}</span><strong>${v.toLocaleString()}<small>건</small></strong></article>`).join('');
  $('rental-coverage').textContent=result.coverage.map(c=>`${{'11':'서울','41':'경기','28':'인천'}[c.region]}: ${c.available?'선택 구간 '+c.available+'개 지역 자료 보유 · 과거 '+c.first+'부터':'선택 구간 미수집'}`).join(' / ')+' · 일부 지역·단지의 과거 이력은 추가 수집 중';
  $('rental-count').textContent=result.count.toLocaleString()+'건 · '+(settings.detail?'선택 단지의 원천 연결 기준':'해당 조건 기준');
  if(isDaily||!result.rows.length)$('rental-rows').innerHTML=result.rows.length?result.rows.map(t=>{const labels=[];if(t.cancelled)labels.push('해제');else if(!raw){for(const [bit,n]of [[1,'신고가'],[2,'신저가'],[4,'하락'],[8,'상승'],[16,'직전 범위 내'],[32,'첫 거래']])if(t.records&bit)labels.push(n);}const cls=t.records&8?'rental-up':t.records&4?'rental-down':'';return `<article class="rental-row ${t.cancelled?'rental-cancelled':''}"><div><a href="${esc(detailURL(t))}" data-rental-link><strong>${esc(t.c.n)}</strong></a><p>${esc(t.c.g)} ${esc(t.c.d)} · ${t.area}㎡ · ${t.floor??'미상'}층</p><p>${t.date} · ${['구분 미상','신규','갱신'][t.contract]}</p></div><div><strong>${settings.type==='jeonse'?money(t.deposit):money(t.deposit)+' / 월 '+money(t.rent)}</strong>${settings.type==='monthly'&&settings.convert?`<p>월 환산 ${money(t.value)}</p><small>${t.rate?`연 ${t.rate}% · ${t.rateMonth} 기준`:'해당 시점 공식 환산율 없음'}</small>`:''}<p class="${cls}">${labels.join(' · ')}</p></div><div>${!raw&&t.previousDate?`<p>직전 ${t.previousDate}</p><p>${money(t.previousLow)} ~ ${money(t.previousHigh)}</p>${t.change!=null?`<strong class="${cls}">${t.change>0?'+':''}${t.change.toFixed(2)}%</strong>${t.annual!=null?`<p>연환산 ${t.annual.toLocaleString('ko-KR',{maximumFractionDigits:2})}%</p><small>거래 간격이 짧으면 수치가 확대됩니다.</small>`:''}`:''}`:'<p>비교 대상 없음 또는 원금액 보기</p>'}</div></article>`;}).join(''):'<p class="rental-empty">선택 조건의 거래가 없습니다. 위 수집 범위도 확인해 주세요.</p>';
  $('rental-more').hidden=result.count<=settings.limit;
  if(!isDaily&&result.rows.length){
   const headers=['계약일','단지','시군구 · 동','면적 / 층','계약 구분','보증금',...(settings.type==='monthly'?['월세']:[]),...(!raw?['비교 가격','판정','직전 대비']:[])];
   $('rental-rows').innerHTML='<div class="rental-table rental-contract-table"><table><thead><tr>'+headers.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+result.rows.map(t=>{
    const cells=[esc(t.date),`<a href="${esc(detailURL(t))}" data-rental-link>${esc(t.c.n)}</a>${t.cancelled?' · 해제':''}`,esc(t.c.g+' '+t.c.d),esc(t.area+'㎡ / '+(t.floor??'미상')+'층'),esc(['미상','신규','갱신'][t.contract]),esc(money(t.deposit))];
    if(settings.type==='monthly')cells.push(esc(money(t.rent)));
    if(!raw){
     const labels=t.cancelled?['해제']:[[1,'신고가'],[2,'신저가'],[4,'하락'],[8,'상승'],[16,'직전 범위 내'],[32,'첫 거래']].filter(([bit])=>t.records&bit).map(([,label])=>label);
     const previous=t.previousDate&&!t.cancelled?`<small>${esc(t.previousDate)} · ${esc(money(t.previousLow))} ~ ${esc(money(t.previousHigh))}</small>`:'';
     const change=t.change==null?'—':`<span class="${t.change>0?'rental-up':'rental-down'}">${t.change>0?'+':''}${t.change.toFixed(2)}%</span>`;
     cells.push(esc(money(t.value))+(settings.type==='monthly'?`<small>${esc(t.rate?'연 '+t.rate+'% · '+t.rateMonth:'공식 환산율 없음')}</small>`:''),esc(labels.join(' · ')),change+previous+(t.annual!=null?`<small title="거래 간격이 짧으면 수치가 확대됩니다.">연환산 ${t.annual.toLocaleString('ko-KR',{maximumFractionDigits:2})}%</small>`:''));
    }
    return `<tr class="${t.cancelled?'rental-cancelled':''}">`+cells.map(c=>'<td>'+c+'</td>').join('')+'</tr>';
   }).join('')+'</tbody></table></div>';
  }
  if(panels.daily){const days=Object.entries(result.daily).sort(([a],[b])=>a.localeCompare(b)),max=Math.max(1,...days.map(([,v])=>v.count));$('rental-chart').innerHTML=days.map(([d,v])=>`<button type="button" data-rental-day="${d}" title="${d} · ${v.count}건"><span style="height:${Math.max(2,v.count/max*120)}px"></span><small>${d.slice(5)}</small><small>${v.count}건</small></button>`).join('')||'거래 없음';}
  if(panels.districts)$('rental-regions').innerHTML=table(['지역 · 계약 구분','거래','보증금 평균','월세 평균',raw?'':'표시 가격 평균'],Object.entries(result.districts).map(([n,a])=>[n,a.count+'건',money(a.deposit/a.count),money(a.rent/a.count),raw?'':money(a.n?a.sum/a.n:null)]));
  if(panels.rank)$('rental-rank').innerHTML=table(['단지','면적','구분','거래','평균 '+(raw?'월세':'표시 가격')],result.rank.map(r=>[r.name,r.area+'㎡',['미상','신규','갱신'][r.contract],r.count+'건',money(r.n?r.sum/r.n:null)]));
  if(!$('rental-trend-panel').hidden){drawTrend(result.trend,raw);$('rental-trend').innerHTML=table(['월','지역','구분','거래','보증금 평균','월세 평균',raw?'':'표시 가격 평균'],[...result.trend].reverse().map(r=>[r.month,{'11':'서울','41':'경기','28':'인천'}[r.region],['미상','신규','갱신'][r.contract],r.count+'건',money(r.deposit),money(r.rent),raw?'':money(settings.type==='jeonse'?r.deposit:r.value)]));}
  // Histogram is returned from all filtered rows, never the paginated visible subset.
  if(panels.histogram)$('rental-distribution').innerHTML=table(['가격 구간','건수'],(result.histogram||[]).map(x=>[money(x.low)+' ~ '+money(x.high)+(x===result.histogram.at(-1)?' 이하':' 미만'),x.count+'건']));
  syncSlider();
 }
 function drawTrend(rows,raw){
  const months=[...new Set(rows.map(r=>r.month))].sort(),groups=new Map(),colors=['#ef4444','#3b82f6','#20a38f','#a855f7','#eab308','#ec4899','#0891b2','#78716c','#f97316'];
  for(const r of rows){const k=({'11':'서울','41':'경기','28':'인천'}[r.region])+' '+['미상','신규','갱신'][r.contract];if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r);}
  const graphs=(raw?[['deposit','보증금 평균'],['rent','월세 평균']]:[[settings.type==='jeonse'?'deposit':'value','표시 가격 평균']]).map(([field,title])=>{
   let max=1;for(const r of rows)if(r[field]!=null)max=Math.max(max,r[field]);let i=0,legend=[];
   const lines=[...groups].map(([key,rs])=>{const color=colors[i++%colors.length];legend.push(`<span style="color:${color}">${esc(key)}</span>`);const pts=rs.filter(r=>r[field]!=null).map(r=>(55+months.indexOf(r.month)/Math.max(1,months.length-1)*825)+','+(215-r[field]/max*190));return `<polyline fill="none" stroke="${color}" stroke-width="2" points="${pts.join(' ')}"/>`;}).join('');
   return `<h3>${title} (만원)</h3><svg viewBox="0 0 910 255" role="img" aria-label="${title} 월별 추이"><text x="0" y="20" fill="currentColor">${Math.round(max).toLocaleString()}</text><text x="35" y="220" fill="currentColor">0</text><path d="M55 25V215H880" fill="none" stroke="currentColor" opacity=".3"/>${lines}<text x="55" y="244" fill="currentColor">${months[0]||''}</text><text x="800" y="244" fill="currentColor">${months.at(-1)||''}</text></svg><div class="rental-legend">${legend.join(' · ')}</div>`;
  });$('rental-trend-graph').innerHTML=graphs.join('');
 }
 function table(headers,rows){return '<div class="rental-table"><table><thead><tr>'+headers.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';}
 async function script(src){await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=()=>reject(Error('지도를 불러오지 못했습니다.'));document.head.append(s);});}
 async function renderMap(next,summaries=[],id=frame){
  if(!mapView){if(!mapCreating)mapCreating=(async()=>{if(!window.L)await script('https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js');await script('/js/rental-map-view.js?v=20260922-frame2');mapView=NodoRentalMapView({settings,refresh,stop,request,detailURL,esc,money});map=mapView.map;})().finally(()=>{mapCreating=null;});await mapCreating;}
  if(id!==frame)return;
  mapView.setData(next,summaries);
 }
 function drawMap(){mapView?.redraw();}
 strip.onclick=e=>{const b=e.target.closest('[data-tenure]');if(!b)return;stop();settings.type=b.dataset.tenure;settings.kind='all';persist();aptSearch.close();if(settings.type!=='sale')aptSearch.restore();if(settings.type==='sale'&&window.NodoRentalInitial){location.reload();return;}refresh();document.dispatchEvent(new Event('nodo-search-context'));};
 form.elements.region.onchange=e=>{stop();settings.region=e.target.value;settings.district='';settings.limit=50;refresh();};
 form.elements.period.onchange=e=>{stop();settings.period=e.target.value;settings.limit=50;refresh();};
 if(!settings.map&&!isDaily)form.elements.day.onchange=e=>{if(!e.target.value)return;stop();settings.day=e.target.value.length===7?e.target.value+'-01':e.target.value;settings.limit=50;refresh();};
 form.onsubmit=e=>{e.preventDefault();stop();for(const [k,v]of new FormData(form))settings[k]=k==='day'&&v.length===7?v+'-01':v;settings.limit=50;refresh();};
 $('rental-convert').onchange=e=>{stop();settings.convert=e.target.checked;settings.kind='all';if(!settings.convert&&['rise','drop'].includes(settings.sort))settings.sort='date';refresh();};
 $('rental-kind').onchange=e=>{settings.kind=e.target.value;settings.limit=50;refresh();};$('rental-sort').onchange=e=>{settings.sort=e.target.value;refresh();};$('rental-more').onclick=()=>{settings.limit+=50;refresh();};$('rental-retry').onclick=refresh;
 root.addEventListener('click',e=>{const a=e.target.closest('[data-rental-link]');if(a){e.preventDefault();e.stopPropagation();location.assign(a.href);}const d=e.target.closest('[data-rental-day]');if(d){settings.day=d.dataset.rentalDay;settings.period='day';settings.limit=50;refresh();}},true);
 async function tick(run=playbackGeneration){if(!playing||run!==playbackGeneration)return;const d=new Date(settings.day+'T00:00:00Z');if($('rental-step').value==='month'){d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+1);}else d.setUTCDate(d.getUTCDate()+Number($('rental-step').value));const day=d.toISOString().slice(0,10);if(day.slice(0,7)>$('rental-end').value||day>meta.lastDate){stop();return;}settings.day=day;await refresh();if(playing&&run===playbackGeneration)timer=setTimeout(()=>tick(run),Number($('rental-speed').value));}
 $('rental-play').onclick=()=>{if(playing){stop();return;}if(!meta)return;settings.day=$('rental-start').value+'-01';const run=++playbackGeneration;playing=true;$('rental-play').textContent='Ⅱ 정지';$('rental-play').setAttribute('aria-pressed','true');refresh().then(()=>{if(playing&&run===playbackGeneration)timer=setTimeout(()=>tick(run),Number($('rental-speed').value));});};
 $('rental-slider').oninput=e=>{stop();frame++;clearTimeout(sliderTimer);const d=new Date($('rental-start').value+'-01T00:00:00Z');d.setUTCDate(d.getUTCDate()+Number(e.target.value));settings.day=d.toISOString().slice(0,10);sliderTimer=setTimeout(refresh,80);};
 $('rental-today').onclick=()=>{stop();settings.day=meta.lastDate;refresh();};
 for(const id of ['rental-start','rental-end'])$(id).onchange=()=>{stop();if($('rental-start').value>$('rental-end').value)$('rental-end').value=$('rental-start').value;settings.day=$('rental-start').value+'-01';refresh();};
  window.addEventListener('pagehide',()=>{stop();clearTimeout(sliderTimer);worker?.terminate();});window.addEventListener('popstate',()=>{const p=new URLSearchParams(location.search);Object.assign(settings,M.normalize(p,{}));for(const n of ['q','district','areaMin','areaMax','depositMin','depositMax','rentMin','rentMax','year','sort'])settings[n]=p.get('rental_'+n)??(n==='sort'?'date':'');refresh();});
 // Keep links shareable, including navigation before a worker has been started.
 document.addEventListener('click',e=>{const a=e.target.closest('.nodo-header a[href]');if(!a)return;const u=new URL(a.href,location.href);if(u.origin!==location.origin||!titles[u.pathname])return;for(const [k,v]of Object.entries(NodoApartmentSearch.params()))u.searchParams.set(k,v);u.searchParams.set('tenure',settings.type);u.searchParams.set('rentConvert',settings.convert?'1':'0');u.searchParams.set('rentDate',settings.day);u.searchParams.set('rentContract',settings.contract);u.searchParams.set('rentRegion',settings.region);a.href=u.href;},true);
 sync();if(settings.type!=='sale'){await aptSearch.restore();await refresh();}
})();
