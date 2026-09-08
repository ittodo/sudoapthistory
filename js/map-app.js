/* Full-screen apartment explorer. Map state is independent of the screener DOM. */
(function() {
  'use strict';
  const $ = id => document.getElementById(id);
  const model = NodoMapModel, services = NodoMapServices;
  const filterKeys = ['aL','aH','pL','pH','uL','uH','bL','bH'];
  const regions = ['경기','서울','인천'];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = value => value == null ? '거래 없음' : (value / 10000).toLocaleString('ko-KR',{maximumFractionDigits:4})+'억';
  let map, markers, boundary, chart, payload, client, byId, filtered=[], matches=new Map();
  let selected=null, selectedArea=null, filters={}, restoring=false, detailToken=0, boundaryToken=0;
  let transactionRows=[], visibleTrades=30, searchTimer, toastTimer, renderFrame, tileFailed=false;
  const storageKey='nodoMapView';

  function toast(message) {
    $('toast').textContent=message; $('toast').hidden=false;
    clearTimeout(toastTimer); toastTimer=setTimeout(()=>{$('toast').hidden=true;},4000);
  }
  function address(c) { return [regions[c.r],c.g,c.d,c.j].filter(Boolean).join(' '); }
  function selectedMatch() { return selected && matches.get(selected.id); }
  function save(push=false) {
    if(restoring || !map || !payload) return;
    const center=map.getCenter(), p=new URLSearchParams();
    p.set('lat',center.lat.toFixed(5)); p.set('lng',center.lng.toFixed(5)); p.set('z',map.getZoom());
    for(const [key,value] of Object.entries(filters)) if(value!=null) p.set(key,value);
    if(selected) {p.set('a',selected.id); if(selectedArea)p.set('ar',selectedArea.a);}
    const hash='#'+p.toString();
    if(location.hash!==hash) history[push?'pushState':'replaceState']({map:true},'',hash);
    try{localStorage.setItem(storageKey,JSON.stringify({lat:center.lat,lng:center.lng,z:map.getZoom()}));}catch{}
  }
  function parseState() {
    const p=new URLSearchParams(location.hash.slice(1));
    let view=null;
    if(p.has('lat') && p.has('lng') && p.has('z')) view={lat:Number(p.get('lat')),lng:Number(p.get('lng')),z:Number(p.get('z'))};
    else if(!location.hash) {try{view=JSON.parse(localStorage.getItem(storageKey));}catch{}}
    if(view && !(view.lat>=33 && view.lat<=40 && view.lng>=124 && view.lng<=132 && view.z>=7 && view.z<=19)) view=null;
    const next={};
    if(p.has('r') && ['0','1','2'].includes(p.get('r'))) next.r=Number(p.get('r'));
    filterKeys.forEach(key=>{const n=Number(p.get(key));if(p.has(key) && p.get(key)!=='' && Number.isFinite(n) && n>=0)next[key]=n;});
    for(const prefix of ['a','p','u','b']) if(next[prefix+'L']>next[prefix+'H']) delete next[prefix+'H'];
    return {view,filters:next,id:p.get('a'),area:p.has('ar')?Number(p.get('ar')):null};
  }
  function syncForm() {
    $('region').value=filters.r??'';
    filterKeys.forEach(k=>{$('filters').elements[k].value=filters[k]??'';});
    const count=filterKeys.filter(k=>filters[k]!=null).length;
    $('filterCount').textContent=count?String(count):'';
    const lo=filters.aL, hi=filters.aH;
    $('areaHint').textContent=lo!=null || hi!=null ? `${lo!=null?(lo/3.3058).toFixed(1):'전체'} ~ ${hi!=null?(hi/3.3058).toFixed(1):'전체'}평` : '㎡ · 평 환산';
  }
  function refilter() {
    filtered=payload.d.map(c=>model.match(c,filters)).filter(Boolean);
    matches=new Map(filtered.map(m=>[m.complex.id,m]));
    if(selected && !matches.has(selected.id)) {close(false);toast('선택한 단지가 필터 조건에서 제외되었습니다.');}
    else if(selected && !selectedMatch().areas.some(a=>a.i===selectedArea?.i)) select(selected.id,null,false,false);
    render();
  }
  function scheduleRender() {cancelAnimationFrame(renderFrame);renderFrame=requestAnimationFrame(render);}
  function render() {
    if(!map || !markers || !payload) return;
    markers.clearLayers();
    const bounds=map.getBounds().pad(.08), zoom=map.getZoom(), buckets=new Map();
    let visible=0, located=0;
    const cellW=zoom<15?120:110, cellH=zoom<15?85:64;
    for(const match of filtered) {
      const c=match.complex;
      if(!c.coord) continue;
      located++;
      if(!bounds.contains(c.coord)) continue;
      visible++;
      // Keep the selected apartment independently reachable and visibly selected.
      if(c.id===selected?.id) {addApartment(match,true);continue;}
      const point=map.project(c.coord,zoom);
      const key=zoom===19 ? c.coord.map(n=>n.toFixed(5)).join('|') : Math.floor(point.x/cellW)+'|'+Math.floor(point.y/cellH);
      if(!buckets.has(key))buckets.set(key,[]);
      buckets.get(key).push(match);
    }
    for(const group of buckets.values()) {
      if(group.length===1 && zoom>=14) {addApartment(group[0]);continue;}
      const center=group.reduce((v,m)=>[v[0]+m.complex.coord[0]/group.length,v[1]+m.complex.coord[1]/group.length],[0,0]);
      const summary=model.clusterSummary(group);
      const average=summary.average==null?'가격 없음':`평균 ${(summary.average/10000).toLocaleString('ko-KR',{minimumFractionDigits:1,maximumFractionDigits:1})}억`;
      const title=`아파트 ${summary.count.toLocaleString()}개 · ${average} · 가격이 있는 ${summary.pricedCount.toLocaleString()}개 단지의 최신 실거래 산술평균 · 면적 필터 반영 · 클릭하여 확대 또는 목록 보기`;
      const point=map.project(group[0].complex.coord,zoom);
      // Wide-area labels use the center of their grid cell to avoid covering each other.
      const labelCenter=zoom<14?map.unproject([(Math.floor(point.x/cellW)+.5)*cellW,(Math.floor(point.y/cellH)+.5)*cellH],zoom):center;
      const marker=L.marker(labelCenter,{icon:L.divIcon({className:'apt-marker',html:`<div class="cluster-label"><strong>${average}</strong><small>${summary.count.toLocaleString()}개 단지</small></div>`,iconSize:[96,52],iconAnchor:[48,26]}),title}).addTo(markers);
      marker.on('click',()=>{
        const same=group.every(m=>Math.abs(m.complex.coord[0]-center[0])<.00002&&Math.abs(m.complex.coord[1]-center[1])<.00002);
        if(zoom>=19 || same && zoom>=17) showOverlap(group,center);
        else map.fitBounds(L.latLngBounds(group.map(m=>m.complex.coord)),{maxZoom:Math.min(19,zoom+2),padding:[70,70]});
      });
    }
    $('mapStatus').textContent=`현재 영역 ${visible.toLocaleString()}개 · 조건 일치 ${filtered.length.toLocaleString()}개${located<filtered.length?' · 위치 확인 중 '+(filtered.length-located).toLocaleString()+'개':''}`;
  }
  function addApartment(match,isSelected=false) {
    const c=match.complex, a=isSelected?selectedArea:match.area, trade=a?.latest;
    const stale=trade && Date.now()-new Date(fmtDate(trade[0])).getTime()>365*86400000;
    const label=`<div class="apt-label ${isSelected?'selected':''} ${stale?'stale':''}"><b>${money(trade?.[1])}</b><small>${a?esc(a.a)+'㎡':''}${stale?' · 1년 전':''}${trade?.[3]&1?' · 직거래':''}</small></div>`;
    const marker=L.marker(c.coord,{icon:L.divIcon({className:'apt-marker',html:label,iconSize:[98,46],iconAnchor:[49,23]}),zIndexOffset:isSelected?1000:0,title:`${c.n} · ${a?fmtArea(a.a):''} · 최근 실거래 ${money(trade?.[1])}${trade?' · '+fmtDate(trade[0]):''}`}).addTo(markers);
    marker.on('click',()=>select(c.id,null,true,false));
  }
  function showOverlap(group,center) {
    const el=document.createElement('div');el.className='overlap-list';
    group.forEach(m=>{const b=document.createElement('button');b.innerHTML=`${esc(m.complex.n)}<small>${esc(address(m.complex))} · ${money(m.area?.latest?.[1])}</small>`;b.onclick=()=>{map.closePopup();select(m.complex.id,null,true,false);};el.append(b);});
    L.popup().setLatLng(center).setContent(el).openOn(map);
  }
  function focusOn(c) {
    if(!c.coord) return;
    map.setView(c.coord,Math.max(16,map.getZoom()),{animate:false});
    map.panBy(innerWidth<768?[0,map.getSize().y*.2]:[-200,0],{animate:false});
  }
  function select(id,area=null,push=true,focus=false) {
    const match=matches.get(id);
    if(!match) {toast('현재 조건에서 해당 단지를 찾을 수 없습니다.');return;}
    selected=match.complex;
    selectedArea=match.areas.find(a=>a.a===area)||match.area||match.areas[0];
    $('detail').hidden=false;$('workspace').classList.add('has-selection');
    if($('detail').dataset.size==='collapsed')$('detail').dataset.size='mid';
    $('detailName').textContent=selected.n;
    $('detailAddress').textContent=address(selected)+(selected.rd?' · '+selected.rd:'');
    $('facts').innerHTML=[selected.tu?`${selected.tu.toLocaleString()}세대`:'세대수 미확인',selected.b?`${selected.b}년 준공`:'준공연도 미확인',`${selected.areas.length}개 평형`].map(t=>`<span>${esc(t)}</span>`).join('');
    $('locationInfo').textContent=selected.coord ? '' : '위치 확인 중 · 상세 정보는 확인할 수 있습니다.';
    renderAreas();renderPrice();loadDetail();loadBoundary();
    if(focus){const before=restoring;restoring=true;focusOn(selected);restoring=before;}
    render();save(push);
  }
  function renderAreas() {
    const allowed=new Set(selectedMatch().areas.map(a=>a.i));
    $('areas').replaceChildren();
    selected.areas.forEach(a=>{const button=document.createElement('button');button.textContent=`${a.a}㎡ · ${(a.a/3.3058).toFixed(1)}평`;button.className=a.i===selectedArea.i?'active':'';button.setAttribute('aria-pressed',a.i===selectedArea.i?'true':'false');button.disabled=!allowed.has(a.i);button.title=button.disabled?'면적 필터에서 제외된 평형':fmtArea(a.a);button.onclick=()=>select(selected.id,a.a,true,false);$('areas').append(button);});
  }
  function renderPrice() {
    const trade=selectedArea.latest;
    $('latestPrice').textContent=money(trade?.[1]);
    $('latestMeta').textContent=trade?`${fmtDate(trade[0])} · ${selectedArea.a}㎡ (${(selectedArea.a/3.3058).toFixed(1)}평) · ${trade[2]}층${trade[3]&1?' · 직거래':''}`:'해제되지 않은 거래가 없습니다.';
    const sameDay=trade?selectedMatch().areas.reduce((n,a)=>n+(a.latest?.[0]===trade[0]?a.latest[4]:0),0):0;
    $('latestNotice').textContent=[sameDay>1?`같은 날짜 거래 ${sameDay}건 · 평형별 내역에서 확인하세요.`:'',trade && Date.now()-new Date(fmtDate(trade[0])).getTime()>365*86400000?'1년 이상 지난 거래입니다.':''].filter(Boolean).join(' ');
    $('screenLink').href='../#'+new URLSearchParams({a:selected.id,ar:selectedArea.a});
    $('dataStamp').textContent=`데이터 기준 ${payload.meta.updated} · 국토교통부 실거래가\n말풍선은 최신 유효 거래, 차트는 월평균 가격입니다.`;
  }
  function retryMessage(target,error,retry) {
    target.replaceChildren(document.createTextNode(error.message+' '));
    const button=document.createElement('button');button.textContent='다시 시도';button.onclick=retry;target.append(button);
    if(error.message.includes('업데이트')){const reload=document.createElement('button');reload.textContent='새로고침';reload.onclick=()=>location.reload();target.append(reload);}
  }
  async function loadDetail() {
    const token=++detailToken, c=selected, area=selectedArea;
    if(chart){chart.destroy();chart=null;}
    $('priceChart').hidden=true;$('chartStatus').textContent='가격 추이를 불러오는 중…';
    $('tradeList').replaceChildren();$('tradeStatus').textContent='거래내역을 불러오는 중…';$('moreTrades').hidden=true;
    const chartTask=client(`data/monthly/${c.g}.json`).then(data=>{
      if(token!==detailToken)return;
      const entry=data[String(area.i)], values=entry?.p;
      if(!values?.some(n=>n>0)){$('chartStatus').textContent='월별 거래 데이터가 없습니다.';return;}
      if(typeof Chart==='undefined')throw new Error('차트 도구를 불러오지 못했습니다. 새로고침해 주세요.');
      const stamp=payload.meta.updated.split('-').map(Number), end=Math.min(values.length,(stamp[0]-2006)*12+stamp[1]);
      const start=Math.max(0,end-60), series=values.slice(start,end), labels=series.map((_,offset)=>`${2006+Math.floor((start+offset)/12)}.${String((start+offset)%12+1).padStart(2,'0')}`);
      $('priceChart').hidden=false;$('chartStatus').textContent='';
      chart=new Chart($('priceChart'),{type:'line',data:{labels,datasets:[{data:series.map(v=>v>0?v:null),borderColor:'#70b5ff',backgroundColor:'#60a5fa18',fill:true,borderWidth:2,pointRadius:2,pointHoverRadius:4,spanGaps:false,tension:.15}]},options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:item=>`${item.parsed.y.toFixed(2)}억`}}},scales:{x:{ticks:{color:'#8c9fb7',maxTicksLimit:5,maxRotation:0},grid:{display:false}},y:{ticks:{color:'#8c9fb7',callback:v=>v+'억'},grid:{color:'#2c3d53'}}}}});
    }).catch(error=>{if(token===detailToken)retryMessage($('chartStatus'),error,loadDetail);});
    const txTask=client(`data/tx/${c.g}.json`).then(data=>{
      if(token!==detailToken)return;
      transactionRows=model.trades(data.entries?.[String(area.i)]);visibleTrades=30;
      $('tradeStatus').textContent=transactionRows.length?'':'거래내역이 없습니다.';renderTrades();
    }).catch(error=>{if(token===detailToken)retryMessage($('tradeStatus'),error,loadDetail);});
    await Promise.allSettled([chartTask,txTask]);
  }
  function renderTrades() {
    $('tradeList').innerHTML=transactionRows.slice(0,visibleTrades).map(t=>`<div class="trade ${t.flags&2?'cancelled':''}"><div>${fmtDate(t.date)}${t.flags&1?'<span class="badge">직거래</span>':''}${t.flags&2?'<span class="badge cancelled">해제</span>':''}<small>${esc(t.floor)}층${t.cancelled?' · 해제일 '+esc(t.cancelled):''}</small></div><strong>${money(t.price)}</strong></div>`).join('');
    $('moreTrades').hidden=visibleTrades>=transactionRows.length;
  }
  async function loadBoundary() {
    const token=++boundaryToken,c=selected;
    if(boundary){boundary.remove();boundary=null;}
    if(!c.pnus.length){$('boundaryInfo').textContent='확인된 필지 경계가 없습니다.';return;}
    $('boundaryInfo').textContent='선택 단지의 필지 경계를 불러오는 중…';
    const features=[], failed=[];
    let cached={};
    try{cached=await client(`data/map/parcels/${c.g}.json`);}catch(error){
      if(token!==boundaryToken)return;
      if(error.message.includes('업데이트')){retryMessage($('boundaryInfo'),error,loadBoundary);return;}
    }
    if(token!==boundaryToken)return;
    // Bound request concurrency, but retain every published parcel member.
    for(let i=0;i<c.pnus.length;i+=4){
      const group=c.pnus.slice(i,i+4);
      const results=await Promise.allSettled(group.map(p=>cached[p]?Promise.resolve(cached[p]):services.parcel(p)));
      if(token!==boundaryToken)return;
      results.forEach((r,j)=>{if(r.status==='fulfilled')features.push(...r.value.features);else failed.push(group[j]);});
    }
    if(features.length)boundary=L.geoJSON({type:'FeatureCollection',features},{interactive:false,style:{color:'#14b8a6',weight:3,fillColor:'#2dd4bf',fillOpacity:.16}}).addTo(map);
    const label=c.scope.startsWith('representative')?'대표 필지':'공개된 단지 필지';
    $('boundaryInfo').textContent=`${label} ${c.pnus.length-failed.length}/${c.pnus.length}개 표시${failed.length?' · 일부 경계를 불러오지 못했습니다.':''}`;
    if(failed.length){const button=document.createElement('button');button.textContent='경계 재시도';button.onclick=loadBoundary;$('boundaryInfo').append(button);}
  }
  function close(push=true) {
    selected=null;selectedArea=null;++detailToken;++boundaryToken;
    if(chart){chart.destroy();chart=null;}if(boundary){boundary.remove();boundary=null;}
    $('detail').hidden=true;$('workspace').classList.remove('has-selection');render();save(push);
  }
  function search() {
    const q=$('search').value.trim().toLocaleLowerCase(), box=$('searchResults');box.replaceChildren();
    if(!q){box.hidden=true;$('search').setAttribute('aria-expanded','false');return;}
    box.hidden=false;$('search').setAttribute('aria-expanded','true');
    const found=filtered.filter(m=>(m.complex.n+' '+address(m.complex)+' '+m.complex.rd).toLocaleLowerCase().includes(q));
    const regional=found.filter(m=>address(m.complex).toLocaleLowerCase().includes(q)&&m.complex.coord);
    if(regional.length>1){const b=document.createElement('button');b.setAttribute('role','option');b.textContent=`‘${$('search').value.trim()}’ 지역 보기 · ${regional.length.toLocaleString()}개`;b.onclick=()=>{box.hidden=true;$('search').setAttribute('aria-expanded','false');close(false);map.fitBounds(L.latLngBounds(regional.map(m=>m.complex.coord)),{maxZoom:16,padding:[45,45]});save(true);};box.append(b);}
    found.slice(0,40).forEach(m=>{const c=m.complex,b=document.createElement('button');b.setAttribute('role','option');b.innerHTML=`${esc(c.n)}<small>${esc(address(c))}${c.coord?'':' · 위치 확인 중'}</small>`;b.onclick=()=>{box.hidden=true;$('search').setAttribute('aria-expanded','false');select(c.id,null,true,true);};box.append(b);});
    if(!found.length){const p=document.createElement('p');p.textContent='조건에 맞는 검색 결과가 없습니다.';box.append(p);}
  }
  function applyFilters(event) {
    event?.preventDefault();const next={};
    if($('region').value!=='')next.r=Number($('region').value);
    for(const key of filterKeys){const input=$('filters').elements[key];if(input.value!==''){const n=Number(input.value);if(!Number.isFinite(n)||n<0){$('filterError').textContent='0 이상의 숫자를 입력해 주세요.';return;}next[key]=n;}}
    for(const p of ['a','p','u','b'])if(next[p+'L']>next[p+'H']){$('filterError').textContent='최솟값은 최댓값보다 클 수 없습니다.';return;}
    $('filterError').textContent='';restoring=true;filters=next;syncForm();refilter();search();restoring=false;save(true);
  }
  function restore() {
    if(!payload)return;restoring=true;
    const state=parseState();filters=state.filters;syncForm();close(false);refilter();
    if(state.view)map.setView([state.view.lat,state.view.lng],state.view.z,{animate:false});
    else map.fitBounds([[36.87,126.36],[38.15,127.84]],{animate:false});
    if(state.id){if(matches.has(state.id))select(state.id,state.area,false,!state.view);else toast('선택 단지가 없거나 현재 조건에서 제외되었습니다.');}
    restoring=false;save();
  }
  function bind() {
    $('closeDetail').onclick=()=>close();$('moreTrades').onclick=()=>{visibleTrades+=30;renderTrades();};
    $('filterToggle').onclick=()=>{const show=$('filters').hidden;$('filters').hidden=!show;$('filterToggle').setAttribute('aria-expanded',String(show));setTimeout(()=>map.invalidateSize(),0);};
    $('filters').onsubmit=applyFilters;$('region').onchange=applyFilters;
    $('resetFilters').onclick=()=>{filters={};syncForm();refilter();search();save(true);};
    $('search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(search,150);};
    $('search').onkeydown=e=>{if(e.key==='ArrowDown'||e.key==='Enter'){const first=$('searchResults').querySelector('button');if(first&&!$('searchResults').hidden){e.preventDefault();first.focus();}}};
    $('searchResults').onkeydown=e=>{const buttons=[...$('searchResults').querySelectorAll('button')],idx=buttons.indexOf(document.activeElement);if(e.key==='ArrowDown'){e.preventDefault();buttons[Math.min(idx+1,buttons.length-1)]?.focus();}if(e.key==='ArrowUp'){e.preventDefault();if(idx>0)buttons[idx-1].focus();else $('search').focus();}};
    document.addEventListener('click',e=>{if(!e.target.closest('.search-wrap')){$('searchResults').hidden=true;$('search').setAttribute('aria-expanded','false');}});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(!$('searchResults').hidden){$('searchResults').hidden=true;$('search').setAttribute('aria-expanded','false');$('search').focus();}else if(!$('filters').hidden){$('filterToggle').click();}else if(selected)close();}});
    $('homeView').onclick=()=>{restoring=true;close(false);map.fitBounds([[36.87,126.36],[38.15,127.84]],{animate:false});restoring=false;save(true);};
    $('share').onclick=async()=>{save();try{await navigator.clipboard.writeText(location.href);toast('현재 지도 링크를 복사했습니다.');}catch{toast('주소창의 링크를 복사해 공유할 수 있습니다.');}};
    document.querySelectorAll('.sheet-controls button').forEach(b=>{b.onclick=()=>{$('detail').dataset.size=b.dataset.size;};});
    let dragY=null;
    $('sheetHandle').onpointerdown=e=>{dragY=e.clientY;e.target.setPointerCapture(e.pointerId);};
    $('sheetHandle').onpointerup=e=>{if(dragY==null)return;const delta=e.clientY-dragY;dragY=null;const sizes=['collapsed','mid','full'],idx=sizes.indexOf($('detail').dataset.size);if(Math.abs(delta)>25)$('detail').dataset.size=sizes[Math.max(0,Math.min(2,idx+(delta<0?1:-1)))];};
    window.addEventListener('popstate',restore);window.addEventListener('hashchange',()=>{if(!history.state?.map)restore();});
    let lastWidth=$('workspace').clientWidth;
    new ResizeObserver(()=>{
      map.invalidateSize({pan:false});
      const width=$('workspace').clientWidth;
      if(width!==lastWidth && selected?.coord){
        const point=map.latLngToContainerPoint(selected.coord), size=map.getSize();
        const x=Math.max(width<768?60:450,Math.min(size.x-60,point.x));
        const y=Math.max(90,Math.min(size.y*(width<768?.42:.85),point.y));
        map.panBy([point.x-x,point.y-y],{animate:false});
      }
      lastWidth=width;scheduleRender();
    }).observe($('workspace'));
  }
  async function start() {
    $('retryStartup').hidden=true;
    try {
      if(typeof L==='undefined')throw new Error('지도 도구를 불러오지 못했습니다. 새로고침해 주세요.');
      const response=await fetch('../data/map/index.json',{cache:'no-cache'});
      if(!response.ok)throw new Error('지도 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
      payload=await response.json();
      if(payload.meta?.version!==1 || !Array.isArray(payload.d))throw new Error('지도 데이터 형식을 확인할 수 없습니다.');
      byId=new Map(payload.d.map(c=>[c.id,c]));
      client=createVerifiedDataClient('../',payload.meta.sources);
      if(!map){
        map=L.map('map',{center:[37.5,127],zoom:9,minZoom:7,maxZoom:19,zoomControl:false,maxBounds:[[32,123],[41,133]],maxBoundsViscosity:.7});
        L.tileLayer(services.tileURL,{maxZoom:19,attribution:'© V-World'}).on('tileerror',()=>{if(!tileFailed){tileFailed=true;toast('배경 지도를 불러오지 못했습니다. 검색과 상세 조회는 사용할 수 있습니다.');}}).addTo(map);
        L.control.zoom({position:'topright'}).addTo(map);
        markers=L.layerGroup().addTo(map);map.on('moveend',()=>{scheduleRender();save();});bind();
      }
      restore();$('startup').hidden=true;
    } catch(error) {
      $('startupMessage').textContent=error.message;$('retryStartup').hidden=false;$('startup').querySelector('.spinner').hidden=true;
    }
  }
  $('retryStartup').onclick=start;
  start();
})();
