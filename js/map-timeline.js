/* Historical views share the existing map, boundaries and region aggregation. */
(function(root){
  'use strict';
  const M=NodoDailyModel,esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=n=>(n/10000).toLocaleString('ko-KR',{maximumFractionDigits:4})+'억';
  const spread=(lo,hi)=>lo===hi?money(lo):money(lo)+'~'+money(hi);
  const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
  function create({map,payload,getFilters,apply,save}){
    const el=document.createElement('section');el.className='timeline';el.setAttribute('aria-label','지도 날짜 선택과 재생');
    const monthPicker=(id,label)=>`<span class="timeline-month-picker" id="${id}Picker"><span>${label}</span><select id="${id}Year" aria-label="${label} 연도" disabled></select><select id="${id}Month" aria-label="${label} 월" disabled></select><input type="hidden" id="${id}"></span>`;
    el.innerHTML=`<div class="timeline-top"><div class="timeline-controls"><strong class="timeline-title">시간으로 보는 거래</strong><select id="timeMode" aria-label="지도 보기"><option value="current">현재 지도</option><option value="price">날짜별 가격</option></select>${monthPicker('timeDate','조회 월')}<span id="timeViewingMonth" class="timeline-viewing-month" hidden></span><button id="timeToday">현재 날짜</button><span id="timeExactDate" class="timeline-effects-note"></span><select id="timeKind" aria-label="거래 분류"><option value="all">전체 거래</option><option value="high">신고가</option><option value="up">직전 대비 상승</option><option value="down">직전 대비 하락</option><option value="low">신저가</option></select><select id="timeDistrict" aria-label="시군구"><option value="">전체 시·군·구</option></select></div><a class="daily-link" id="timeList" href="/trades/daily/">일별 거래 목록 ↗</a></div><div id="timeControls" class="timeline-controls" hidden>${monthPicker('timeStart','시작')}${monthPicker('timeEnd','종료')}<button id="timePrev" aria-label="이전 시점">←</button><button id="timePlay" aria-label="시간 재생" aria-pressed="false">▶ 재생</button><button id="timeNext" aria-label="다음 시점">→</button><select id="timeStep" aria-label="재생 간격"><option value="day">하루씩</option><option value="week">일주일씩</option><option value="month">한 달씩</option></select><select id="timeSpeed" aria-label="재생 속도"><option value="1">1배</option><option value="2">2배</option><option value="4">4배</option></select><label><input id="timeEffects" type="checkbox" checked>거래 효과</label><input id="timeSlider" type="range" aria-label="선택 계약일" min="0" max="29" value="29"></div><p class="timeline-effects-note" id="timeEffectLegend" hidden>거래 발생 지점 · 빨강 상승 / 파랑 하락 / 초록 첫 거래·보합·혼합 · 직전 계약일 평균 대비</p><p class="timeline-status" id="timeStatus">날짜를 선택해 과거 거래를 확인하세요.</p><button id="timeRetry" hidden>다시 시도</button>`;
    const $=id=>el.querySelector('#'+id);
    const panel=NodoMapTimelinePanel.mount({host:document.getElementById('workspace'),content:el,playButton:$('timePlay'),retryButton:$('timeRetry')});
    let client,clientPromise,mode='current',day='',start='',end='',kind='all',district='',step='day',speed=1;
    let timer=null,playing=false,loading=false,request=0,complexes=[],currentFilters={},pendingFocus=null,selectedId=null;
    const preferenceKey='nodo-map-timeline-v1';let preferences={version:1,mode:'current',price:null},restoredOnce=false;
    try{const stored=JSON.parse(localStorage.getItem(preferenceKey));if(stored?.version===1&&['current','price'].includes(stored.mode)){preferences.mode=stored.mode;if(stored.price&&typeof stored.price==='object'&&!Array.isArray(stored.price))preferences.price=Object.fromEntries(['date','start','end','step','speed','fx','g'].filter(k=>['string','number'].includes(typeof stored.price[k])).map(k=>[k,String(stored.price[k])]));}}catch{}
    function remember(){
      if(mode==='price')preferences.price={date:day,start,end,step,speed,fx:$('timeEffects').checked?'1':'0',g:district};
      preferences.mode=mode;try{const value=JSON.stringify(preferences);if(localStorage.getItem(preferenceKey)!==value)localStorage.setItem(preferenceKey,value);}catch{}
    }
    function applyPreference(p){day=p.get('date')||'';start=p.get('start')||'';end=p.get('end')||'';district=M.filters(p).g||'';step=['week','month'].includes(p.get('step'))?p.get('step'):'day';speed=[1,2,4].includes(Number(p.get('speed')))?Number(p.get('speed')):1;$('timeEffects').checked=p.get('fx')!=='0';}
    const original=new Map(payload.d.flatMap(c=>[[c.id,c],...(c.memberSources||[]).map(s=>[s.id,c])]));
    const effects=NodoMapEffects.create(map);
    let renderedMode='current',renderedDay='',priceSignature='',priceGroups=new Map(),priceAreaOwners=new Map(),districtRegion;
    function stop(){playing=false;clearTimeout(timer);timer=null;$('timePlay').textContent='▶ 재생';$('timePlay').setAttribute('aria-pressed','false');}
    async function ensure(){if(!clientPromise)clientPromise=NodoDailyClient.create().catch(e=>{clientPromise=null;throw e;});client=await clientPromise;if(client.index.mapVersion!==payload.meta.sourceVersion)throw Error('지도와 일별 데이터가 업데이트 중입니다. 새로고침해 주세요.');return client;}
    function settings(){return {...getFilters(),...(district?{g:district}:{})};}
    function sync(){
      panel.sync({summary:(mode==='current'?'현재 지도 · '+today():'표시일 · '+(day||'준비 중')),playable:mode!=='current'});
      $('timeMode').value=mode;$('timeDate').value=day;$('timeStart').value=start;$('timeEnd').value=end;$('timeKind').value=kind;$('timeStep').value=step;$('timeSpeed').value=String(speed);
      $('timeControls').hidden=mode==='current';$('timeDatePicker').hidden=mode!=='current';$('timeViewingMonth').hidden=mode==='current';$('timeViewingMonth').textContent=M.valid(day)?'조회 월 '+day.slice(0,4)+'년 '+Number(day.slice(5,7))+'월':'조회 월 준비 중';$('timeExactDate').hidden=false;$('timeKind').hidden=mode!=='day';$('timeDistrict').hidden=mode==='current';$('timeList').hidden=mode==='current';$('timeDate').disabled=mode==='current';$('timeKind').disabled=mode!=='day';$('timeDistrict').disabled=mode==='current';
      $('timePlay').disabled=!client;$('timeEffectLegend').hidden=mode!=='price';$('timeEffects').disabled=mode!=='price';
      $('timeExactDate').textContent=mode==='current'?'오늘 '+today():'표시일 '+day+' · 재생 '+start+' ~ '+end;
      if(client){for(const id of ['timeDate','timeStart','timeEnd']){
        const value={timeDate:mode==='current'?today():day,timeStart:start,timeEnd:end}[id]||client.index.maxDate,y=$(id+'Year'),m=$(id+'Month');
        if(!y.options.length){for(let year=Math.max(Number(today().slice(0,4)),Number(client.index.maxDate.slice(0,4)));year>=Number(client.index.minDate.slice(0,4));year--)y.add(new Option(year+'년',String(year)));for(let month=1;month<=12;month++)m.add(new Option(month+'월',String(month).padStart(2,'0')));}
        y.value=value.slice(0,4);m.value=value.slice(5,7);y.disabled=m.disabled=id==='timeDate'?mode!=='current':mode==='current';
        for(const option of m.options){const ym=y.value+'-'+option.value;option.disabled=ym<client.index.minDate.slice(0,7)||ym>client.index.maxDate.slice(0,7);}
      }}
      if(client){for(const id of ['timeDate','timeStart','timeEnd']){$(id).min=client.index.minDate;$(id).max=client.index.maxDate;}
        $('timeSlider').max=Math.max(0,Math.round((Date.parse(end)-Date.parse(start))/M.DAY));$('timeSlider').value=Math.max(0,Math.round((Date.parse(day)-Date.parse(start))/M.DAY));
        const r=getFilters().r??'all';if(districtRegion!==r){const options=[...new Set(client.catalog.complexes.filter(c=>r==='all'||c.r===r).map(c=>c.g))].sort();
          $('timeDistrict').innerHTML='<option value="">전체 시·군·구</option>'+options.map(g=>`<option value="${esc(g)}">${esc(g)}</option>`).join('');districtRegion=r;}
        // Keep a multi-district filter from the period list visible in the map selector.
        const districtSelect=$('timeDistrict');districtSelect.querySelector('[data-combined-districts]')?.remove();
        if(district.includes(',')){const names=district.split(','),option=new Option(names[0]+' 외 '+(names.length-1)+'곳',district);option.dataset.combinedDistricts='';districtSelect.append(option);}
        districtSelect.value=district;
      }
      $('timePrev').disabled=day<=start;$('timeNext').disabled=day>=end;
      const {searchIds,...urlFilters}=settings(),p=new URLSearchParams({date:day,kind:mode==='day'?kind:'all',...urlFilters}),selection=new URLSearchParams(window.NodoApartmentSearch?.params());$('timeList').href='/trades/daily/'+(selection.size?'?'+selection:'')+'#'+p;
      document.querySelector('.legend').innerHTML=mode==='current'?'<span></span>최근 실거래 <small>지역별 단지 평균 · 매매</small>':`<span></span>${esc(day)} ${mode==='day'?'당일 거래':'날짜별 가격'} <small>지역: 대표면적 평균 · 직거래 제외</small>`;
      document.querySelector('.legend').title=mode==='current'?'필터에 맞는 단지별 최신 실거래의 산술평균':'선택 시점의 단지 대표면적별 평균가격을 지역 단위로 집계합니다. 직거래는 제외합니다.';
    }
    function updatePriceGroups(frame,filters){
      const signature=JSON.stringify(filters),reset=frame.reset||priceSignature!==signature||renderedMode!=='price';
      if(reset){priceGroups=new Map();priceAreaOwners=new Map();priceSignature=signature;}
      const dirty=new Set(),updated=[];
      function accept(state){
        const [ai,date,min,max,mean,count]=state;
        let key=priceAreaOwners.get(ai);
        if(key===false)return;
        if(key==null){
          const [ci,size]=client.catalog.areas[ai],source=client.catalog.complexes[ci];
          if(!M.match({a:Number(size),p:mean,c:source},{...filters,pL:null,pH:null})){priceAreaOwners.set(ai,false);return;}
          const base=original.get(source.id);key=base?.id||source.id;priceAreaOwners.set(ai,key);
          if(!priceGroups.has(key)){const c={...(base||source),id:key,pnus:base?.pnus||[],areas:[],dailyRows:[],areaMap:new Map()};priceGroups.set(key,c);if(!reset)complexes.push(c);}
          const c=priceGroups.get(key),area={i:ai,a:Number(size),sourceName:source.n};c.areaMap.set(ai,area);c.areas.push(area);
        }
        const c=priceGroups.get(key),a=c.areaMap.get(ai);
        a.latest=[date,mean,0,0,count];a.min=min;a.max=max;dirty.add(key);
      }
      if(reset)for(const values of frame.values)for(const state of values.values())accept(state);
      else for(const event of frame.changes)accept(event.state);
      for(const id of dirty){const c=priceGroups.get(id);c.areas.sort((a,b)=>b.latest[0]-a.latest[0]||a.a-b.a||a.i-b.i);updated.push(c);}
      return {complexes:reset?[...priceGroups.values()]:complexes,changed:reset?null:updated};
    }
    function buildComplexes(entries){
      const groups=new Map();
      for(const [ai,value]of entries){
        const [ci,size]=client.catalog.areas[ai],source=client.catalog.complexes[ci],base=original.get(source.id);
        const key=base?.id||source.id;
        if(!groups.has(key))groups.set(key,{...(base||source),id:key,pnus:base?.pnus||[],areas:[],dailyRows:[]});
        const c=groups.get(key),a=Number(size);
        if(mode==='day'){
          const trades=value,prices=trades.map(t=>t.p),eligible=trades.filter(t=>!(t.flags&1)),comparison=eligible.map(t=>t.p);
          const min=Math.min(...prices),max=Math.max(...prices),mean=prices.reduce((x,y)=>x+y,0)/prices.length;
          const records=trades.reduce((n,t)=>n|t.records,0);
          c.areas.push({i:ai,a,latest:[M.number(day),comparison.length?comparison.reduce((x,y)=>x+y,0)/comparison.length:mean,0,comparison.length?0:1,trades.length],min,max,records,sourceName:source.n,excludeAggregate:!eligible.length});
          c.dailyRows.push(...trades);
        }else{
          const [,date,min,max,mean,count]=value;
          c.areas.push({i:ai,a,latest:[date,mean,0,0,count],min,max,sourceName:source.n});
        }
      }
      for(const c of groups.values())c.areas.sort((a,b)=>b.latest[0]-a.latest[0]||a.a-b.a||a.i-b.i);
      return [...groups.values()];
    }
    async function refresh({keepPlaying=false}={}){
      if(!keepPlaying)stop();const serial=++request;loading=true;el.setAttribute('aria-busy','true');selectedId=null;map.closePopup();effects.clear();$('timeRetry').hidden=true;
      if(mode==='current'){
        loading=false;el.setAttribute('aria-busy','false');complexes=[];renderedMode='current';priceGroups.clear();priceAreaOwners.clear();document.body.classList.remove('timeline-loading');apply(null);sync();save();
        $('timeStatus').textContent='현재 지도 · 조회 월을 고르면 해당 월말 가격으로 이동합니다.';
        try{await ensure();if(serial!==request)return false;sync();$('timeStatus').textContent='오늘 '+today()+' 기준 현재 지도 · 거래 자료는 '+client.index.maxDate+'까지 · 조회 월 선택 시 해당 월말 가격으로 이동합니다.';}
        catch(e){if(serial!==request)return false;$('timeStatus').textContent=e.message;$('timeRetry').hidden=false;}
        return true;
      }
      root.NodoApartmentLinks?.close();
      // Never leave today's prices behind while a historical request is pending.
      // Keep the last completed frame visible during same-mode date changes.
      document.body.classList.toggle('timeline-loading',renderedMode!==mode);
      $('timeStatus').textContent='선택 시점의 거래를 불러오는 중…'+(renderedDay&&renderedMode===mode?' · 지도는 '+renderedDay+' 기준':'' );
      try{
        await ensure();if(serial!==request)return false;
        day=M.valid(day)?day:client.index.maxDate;day=day<client.index.minDate?client.index.minDate:day>client.index.maxDate?client.index.maxDate:day;
        start=M.valid(start)?start:day.slice(0,7)+'-01';start=start<client.index.minDate?client.index.minDate:start;
        end=M.valid(end)?end:M.periodRange(day,'month').end;end=end>client.index.maxDate?client.index.maxDate:end;
        if(start>end){start=day;end=day;}if(day<start)start=day;if(day>end)end=day;
        sync();currentFilters=settings();
        let entries,status,priceFrame,fromDate=keepPlaying&&renderedMode==='price'&&renderedDay<day?renderedDay:null;
        if(mode==='day'){
          const all=await client.trades(day.slice(0,7),currentFilters);if(serial!==request)return false;
          const rows=all.filter(t=>t.d===M.number(day)&&M.match(t,currentFilters)&&M.category(t,kind));
          entries=new Map();for(const t of rows){if(!entries.has(t.ai))entries.set(t.ai,[]);entries.get(t.ai).push(t);}
          const s=M.summary(rows);status=`${day} · ${s.count.toLocaleString()}건 · 신고가 ${s.high} · 상승 ${s.up} · 하락 ${s.down} · 신저가 ${s.low} · 위치 미확인 ${s.unlocated}건`;
        }else{
          priceFrame=await client.priceFrame(day,currentFilters,fromDate);if(serial!==request)return false;
          status=`${day}까지의 마지막 거래 · 직거래 제외 · 가격 범위는 마지막 계약일 최저~최고`;
        }
        const renderStarted=performance.now();
        if(priceFrame){const result=updatePriceGroups(priceFrame,currentFilters);complexes=result.complexes;apply(complexes,result.changed);}
        else{complexes=buildComplexes(entries);apply(complexes);}
        loading=false;el.setAttribute('aria-busy','false');document.body.classList.remove('timeline-loading');sync();save();
        el.dataset.renderMs=String(Math.round(performance.now()-renderStarted));
        if(priceFrame){
          const visible=new Map(complexes.map(c=>[c.id,c])),pulses=[];
          for(const event of priceFrame.events){const [ai,date,min,max,mean,count]=event.state;if(!fromDate&&date!==M.number(day))continue;
            const key=priceAreaOwners.get(ai),c=visible.get(key);if(!c||!NodoMapModel.match(c,getFilters()))continue;
            pulses.push({coord:c.coord,count,direction:event.previous?Math.sign(mean-event.previous[4]):0});
          }
          if($('timeEffects').checked)effects.burst(pulses);const count=pulses.reduce((n,e)=>n+e.count,0);status+=` · ${fromDate?'재생 구간':'선택일'} 거래 ${count.toLocaleString()}건`;
        }
        renderedMode=mode;renderedDay=day;
        $('timeStatus').textContent=status+' · 현재 유효 이력으로 재구성 · 단지/경계는 현재 정보';
        client.prefetch(day,currentFilters,mode==='price');
        if(pendingFocus){const c=complexes.find(c=>c.id===pendingFocus||c.memberSources?.some(s=>s.id===pendingFocus));if(c?.coord){map.setView(c.coord,Math.max(16,map.getZoom()),{animate:false});select(c.id);}pendingFocus=null;}
        return true;
      }catch(e){if(serial!==request)return false;stop();el.setAttribute('aria-busy','false');$('timeStatus').textContent=e.message+(renderedDay&&renderedMode===mode?' · 지도는 '+renderedDay+' 기준 유지':'');$('timeRetry').hidden=false;return false;}
    }
    function write(p){remember();if(mode==='current'){p.set('mode','current');return;}p.set('mode',mode);p.set('date',day);p.set('start',start);p.set('end',end);p.set('step',step);p.set('speed',speed);p.set('kind',kind);if(district)p.set('g',district);if(selectedId)p.set('a',selectedId);if(!$('timeEffects').checked)p.set('fx','0');}
    function restore(){
      stop();let p=new URLSearchParams(location.hash.slice(1));
      const explicit=['mode','date','start','end','step','speed','fx','a'].some(key=>p.has(key));
      if(!restoredOnce&&!explicit){p=new URLSearchParams(preferences.price||{});p.set('mode',preferences.mode);}
      restoredOnce=true;mode=['day','price'].includes(p.get('mode'))?'price':'current';applyPreference(p);kind='all';pendingFocus=p.get('a');sync();return refresh();
    }
    function label(match){const a=match.area;if(!a)return '';const cls=a.records&1?'daily-high':a.records&4?'daily-down':a.records&2?'daily-low':'';return `<div class="apt-label daily-time ${cls}"><b>${spread(a.min,a.max)}</b><small>${a.a}㎡ · ${mode==='day'?a.latest[4]+'건':M.iso(a.latest[0]).slice(2)}</small></div>`;}
    function select(id){
      if(loading)return;
      stop();const c=complexes.find(c=>c.id===id);if(!c?.coord)return;
      selectedId=id;save();
      const div=document.createElement('div');div.className='timeline-popup';
      let rows=mode==='day'?c.dailyRows.map(t=>`<div class="timeline-item"><b>${money(t.p)}</b> · ${t.a}㎡ · ${t.f??'미상'}층<p>${esc(M.badge(t))}</p>${t.previousMin?`<p>직전 ${M.iso(t.previousDate)} 최저 ${money(t.previousMin)}<br>대비 ${((t.p/t.previousMin-1)*100).toFixed(2)}%</p>`:''}</div>`):c.areas.map(a=>`<div class="timeline-item"><b>${spread(a.min,a.max)}</b> · ${a.a}㎡<p>${M.iso(a.latest[0])} 계약 · ${a.latest[4]}건 · ${esc(a.sourceName)}</p></div>`);
      const detail= '/apartment/?'+new URLSearchParams({id:c.publicationId||c.publicId||c.id,tab:'trades'});
      div.innerHTML=`<h3>${esc(c.n)}</h3><p>${esc(day)} ${mode==='day'?'당일 거래':'이전 마지막 가격'}</p>${rows.join('')}<p><a href="${esc(detail)}">최신 단지 상세로 이동 ↗</a></p>`;
      L.popup({maxWidth:340,autoPanPaddingTopLeft:[10,75],autoPanPaddingBottomRight:[10,20]}).setLatLng(root.NodoMapModel.labelPosition(c,map)).setContent(div).openOn(map);
    }
    async function tick(){if(!playing)return;const next=M.shift(day,1,step);if(day>=end){stop();return;}day=next>end?end:next;const ok=await refresh({keepPlaying:true});if(ok&&playing){if(day>=end)stop();else timer=setTimeout(tick,1000/speed);}}
    $('timePlay').onclick=()=>{if(playing){stop();return;}if(!client)return;playing=true;$('timePlay').textContent='❚❚ 일시정지';$('timePlay').setAttribute('aria-pressed','true');if(day>=end)day=start;refresh({keepPlaying:true}).then(ok=>{if(ok&&playing)timer=setTimeout(tick,1000/speed);});};
    $('timeToday').onclick=()=>{remember();mode='current';refresh();};
    $('timeMode').onchange=()=>{remember();mode=$('timeMode').value;if(mode==='price'&&preferences.price)applyPreference(new URLSearchParams(preferences.price));refresh();};
    for(const id of ['timeDate','timeStart','timeEnd'])for(const suffix of ['Year','Month'])$(id+suffix).onchange=()=>{
      if(!client||(id==='timeDate'&&mode!=='current'))return;stop();let ym=$(id+'Year').value+'-'+$(id+'Month').value;
      ym=ym<client.index.minDate.slice(0,7)?client.index.minDate.slice(0,7):ym>client.index.maxDate.slice(0,7)?client.index.maxDate.slice(0,7):ym;
      const bounds=M.periodRange(ym+'-01','month',client.index.minDate,client.index.maxDate);
      if(id==='timeDate'){if(mode==='current')mode='price';start=bounds.from;end=bounds.to;day=mode==='price'?end:start;}
      else if(id==='timeStart'){start=bounds.from;if(start>end)end=bounds.to;day=start;}
      else {end=bounds.to;if(end<start)start=bounds.from;day=day<start?start:day>end?end:day;}
      refresh();
    };
    $('timeSlider').oninput=()=>{day=M.shift(start,Number($('timeSlider').value));refresh();};
    $('timePrev').onclick=()=>{const next=M.shift(day,-1,step);day=next<start?start:next;refresh();};$('timeNext').onclick=()=>{const next=M.shift(day,1,step);day=next>end?end:next;refresh();};
    $('timeKind').onchange=()=>{kind=$('timeKind').value;refresh();};$('timeDistrict').onchange=()=>{district=$('timeDistrict').value;refresh();};
    $('timeStep').onchange=()=>{stop();step=$('timeStep').value;save();};$('timeSpeed').onchange=()=>{stop();speed=Number($('timeSpeed').value);save();};
    $('timeEffects').onchange=()=>{effects.clear();save();};
    $('timeRetry').onclick=()=>location.reload();
    window.addEventListener('pagehide',stop);document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
    document.addEventListener('click',e=>{if(e.target.closest('a[href*="/apartment/"]'))stop();},true);
    return {refresh,restore,write,label,select,stop,resetFilters(){district='';kind='all';return refresh();},active:()=>mode!=='current'};
  }
  root.NodoMapTimeline={create};
})(window);
