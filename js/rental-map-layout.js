/* Rental maps share the sale map's search toolbar and collapsible date overlay. */
window.NodoRentalMapLayout=({root,form,settings,getMeta,refresh,stop})=>{
  const $=id=>document.getElementById(id),label=name=>form.elements[name].closest('label');
  root.classList.add('rental-map-page');
  for(const child of root.children)if(!['rental-filters','rental-playback','rental-map'].includes(child.id))child.dataset.rentalMapExtra='';
  form.className='rental-map-search';
  const toolbar=document.createElement('div');toolbar.className='toolbar rental-map-toolbar';
  form.prepend(toolbar);
  const search=label('q'),region=label('region');search.className='rental-map-searchbox';
  search.firstChild.textContent='';form.elements.q.placeholder='단지명, 지역명으로 찾기';form.elements.q.setAttribute('aria-label','단지·지역 검색');
  region.firstChild.textContent='';form.elements.region.setAttribute('aria-label','지역');form.elements.region.options[0].textContent='수도권 전체';
  toolbar.append(search,region);toolbar.insertAdjacentHTML('beforeend','<button type="button" id="rental-filter-toggle" aria-expanded="false" aria-controls="rental-map-filters">필터</button><button type="button" id="rental-map-reset">초기화</button>');
  const panel=document.createElement('div');panel.id='rental-map-filters';panel.className='rental-controls';panel.hidden=true;
  form.append(panel);
  for(const name of ['areaMin','depositMin','rentMin','contract'])panel.append(label(name));
  for(const [key,title]of [['area','전용면적'],['deposit','보증금'],['rent','월세']])for(const edge of ['Min','Max'])form.elements[key+edge].setAttribute('aria-label',title+(edge==='Min'?' 최소':' 최대'));
  panel.append(form.querySelector('[type=submit]'));panel.querySelector('[type=submit]').textContent='적용';
  const day=label('day'),district=label('district');
  for(const name of ['day','district'])form.elements[name].setAttribute('form',form.id);
  day.className=district.className='rental-map-inline';district.firstChild.textContent='';form.elements.district.setAttribute('aria-label','시군구');
  const playback=$('rental-playback');playback.className='timeline rental-map-timeline';
  const controls=playback.querySelector('.rental-controls');controls.className='timeline-controls rental-map-play-controls';
  const top=document.createElement('div');top.className='timeline-controls rental-map-time-top';
  playback.prepend(top);
  top.innerHTML='<strong class="timeline-title">시간으로 보는 거래</strong><select id="rental-map-mode" aria-label="지도 보기"><option value="current">현재 지도</option><option value="price" selected>날짜별 가격</option></select>';
  const kind=$('rental-kind').closest('label');kind.className='rental-map-inline';kind.firstChild.textContent='';$('rental-kind').setAttribute('aria-label','거래 분류');
  top.append(day,$('rental-today'),district,$('rental-convert-wrap'),kind);$('rental-today').textContent='현재 날짜';
  top.insertAdjacentHTML('beforeend','<a id="rental-map-list" class="daily-link" href="/trades/daily/">일별 거래 목록 ↗</a>');
  const prev=document.createElement('button'),next=document.createElement('button');
  prev.type=next.type='button';prev.textContent='←';next.textContent='→';prev.id='rental-map-prev';next.id='rental-map-next';prev.setAttribute('aria-label','이전 시점');next.setAttribute('aria-label','다음 시점');
  controls.insertBefore(prev,$('rental-play'));$('rental-play').after(next);
  const pickers=[];
  for(const [id,title]of [['rental-start','시작'],['rental-end','종료']]){
    const input=$(id),wrap=input.closest('label');wrap.firstChild.textContent=title;input.type='hidden';
    const year=document.createElement('select'),month=document.createElement('select');year.setAttribute('aria-label',title+' 연도');month.setAttribute('aria-label',title+' 월');
    wrap.className='rental-map-inline';wrap.append(year,month);pickers.push({input,year,month});
    const change=()=>{const meta=getMeta();input.value=[meta.months[0],year.value+'-'+month.value,meta.months.at(-1)].sort()[1];input.dispatchEvent(new Event('change'));};year.onchange=month.onchange=change;
  }
  for(const id of ['rental-step','rental-speed']){const el=$(id);el.setAttribute('aria-label',id==='rental-step'?'재생 간격':'재생 속도');el.closest('label').className='rental-map-inline';el.closest('label').firstChild.textContent='';}
  controls.append($('rental-slider'));
  const note=playback.querySelector('p');note.className='timeline-effects-note';note.id='rental-map-price-note';
  playback.prepend(top);playback.append($('rental-status'),$('rental-retry'));
  $('rental-status').className='timeline-status';delete $('rental-status').dataset.rentalMapExtra;delete $('rental-retry').dataset.rentalMapExtra;
  const buffer=document.createElement('p');buffer.id='rental-buffer';buffer.className='rental-note';buffer.hidden=true;buffer.setAttribute('role','status');playback.append(buffer);
  const details=document.createElement('details');details.className='rental-map-notes';details.innerHTML='<summary>자료 범위·가격 기준</summary>';playback.append(details);details.append($('rental-rate'),$('rental-coverage'));
  delete $('rental-rate').dataset.rentalMapExtra;delete $('rental-coverage').dataset.rentalMapExtra;playback.append(details);
  const workspace=document.createElement('div');workspace.className='rental-map-workspace';
  $('rental-map').before(workspace);workspace.append($('rental-map'));
  const timelinePanel=NodoMapTimelinePanel.mount({host:workspace,content:playback,playButton:$('rental-play'),retryButton:$('rental-retry')});
  // Keep hidden named inputs registered with the form after moving visible controls.
  const unused=document.createElement('div');unused.hidden=true;for(const name of ['period','year'])unused.append(label(name));
  form.replaceChildren(toolbar,panel,unused);
  const apply=()=>{stop();for(const [k,v]of new FormData(form))settings[k]=v;settings.limit=50;refresh();};
  form.elements.region.onchange=()=>{form.elements.district.value='';apply();};form.elements.district.onchange=apply;
  form.elements.day.onchange=apply;form.elements.q.onchange=apply;
  form.elements.q.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();apply();}};
  $('rental-filter-toggle').onclick=()=>{panel.hidden=!panel.hidden;$('rental-filter-toggle').setAttribute('aria-expanded',String(!panel.hidden));};
  $('rental-map-reset').onclick=()=>{stop();form.elements.q._aptSearch?.clear({notify:false});for(const k of ['q','district','region','areaMin','areaMax','depositMin','depositMax','rentMin','rentMax'])settings[k]='';settings.contract='all';settings.kind='all';settings.convert=false;refresh();};
  $('rental-map-mode').onchange=()=>{stop();if($('rental-map-mode').value==='current'&&getMeta())settings.day=getMeta().lastDate;refresh();};
  function shift(direction){stop();const date=new Date(settings.day+'T00:00:00Z'),step=$('rental-step').value;if(step==='month'){date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+direction);}else date.setUTCDate(date.getUTCDate()+Number(step)*direction);const meta=getMeta();settings.day=[meta.months[0]+'-01',date.toISOString().slice(0,10),meta.lastDate].sort()[1];refresh();}
  prev.onclick=()=>shift(-1);next.onclick=()=>shift(1);
  // District choices are synchronized by the shared rental form.
  return {sync(){
    const meta=getMeta(),current=$('rental-map-mode').value==='current';controls.hidden=current;form.elements.day.readOnly=current;
    timelinePanel.sync({summary:(current?'현재 지도 · ':'표시일 · ')+(settings.day||'준비 중'),playable:!current});
    if(settings.type!=='monthly'){settings.rentMin=settings.rentMax='';form.elements.rentMin.value=form.elements.rentMax.value='';}
    $('rental-map-list').href='/trades/daily/?'+new URLSearchParams({...window.NodoApartmentSearch?.params(),tenure:settings.type,rentDate:settings.day,rentRegion:settings.region,rentContract:settings.contract,rentConvert:settings.convert?'1':'0',rental_district:settings.district});
    label('rentMin').hidden=settings.type!=='monthly';
    note.textContent='선택일까지 마지막으로 확인된 거래 · '+(settings.type==='jeonse'?'대표 거래의 전세 보증금':settings.convert?'월 환산액 = 월세 + 보증금 × 연 환산율 ÷ 12':'대표 거래의 보증금 / 월세')+' · 지도 위치가 확인된 단지만 표시';
    prev.disabled=next.disabled=!meta;$('rental-play').disabled=!meta;$('rental-today').disabled=!meta;$('rental-slider').disabled=!meta;
    if(!meta)return;
    prev.disabled=settings.day<=meta.months[0]+'-01';next.disabled=settings.day>=meta.lastDate;
    for(const {input,year,month}of pickers){
      if(!year.options.length){for(let y=Number(meta.lastDate.slice(0,4));y>=Number(meta.months[0].slice(0,4));y--)year.add(new Option(y+'년',y));for(let m=1;m<=12;m++)month.add(new Option(m+'월',String(m).padStart(2,'0')));}
      year.value=input.value.slice(0,4);month.value=input.value.slice(5,7);
      for(const option of month.options){const ym=year.value+'-'+option.value;option.disabled=ym<meta.months[0]||ym>meta.lastDate.slice(0,7);}
    }
  }};
};
