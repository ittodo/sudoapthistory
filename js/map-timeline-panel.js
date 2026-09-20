/* Keep date controls above the map without taking height away from it. */
(function(root){
  'use strict';
  root.NodoMapTimelinePanel={mount({host,content,playButton,retryButton}){
    const panel=document.createElement('section');panel.className='map-timeline-panel';panel.setAttribute('aria-label','지도 날짜 선택과 재생');
    content.id ||= 'sale-map-timeline';
    const heading=document.createElement('div');heading.className='map-timeline-heading';
    const toggle=document.createElement('button');toggle.type='button';toggle.className='map-timeline-toggle';toggle.setAttribute('aria-controls',content.id);toggle.setAttribute('aria-expanded','false');
    toggle.innerHTML='<span><strong>시간으로 보는 거래</strong><small class="map-timeline-summary"></small></span><span class="map-timeline-chevron" aria-hidden="true">⌄</span>';
    const quickPlay=document.createElement('button');quickPlay.type='button';quickPlay.className='map-timeline-play';quickPlay.hidden=true;
    heading.append(toggle,quickPlay);panel.append(heading,content);host.append(panel);content.hidden=true;
    content.querySelector('.timeline-title')?.remove();
    let summaryText='';
    const syncSummary=()=>{toggle.querySelector('small').textContent=retryButton&&!retryButton.hidden?'자료 확인 필요 · 펼쳐서 다시 시도':summaryText;};
    if(retryButton)new MutationObserver(syncSummary).observe(retryButton,{attributes:true,attributeFilter:['hidden']});
    const setOpen=open=>{content.hidden=!open;toggle.setAttribute('aria-expanded',String(open));};
    toggle.onclick=()=>setOpen(content.hidden);
    panel.addEventListener('keydown',event=>{if(!event.defaultPrevented&&event.key==='Escape'&&!content.hidden){event.preventDefault();event.stopPropagation();setOpen(false);toggle.focus();}});
    quickPlay.onclick=()=>playButton.click();
    const syncPlay=()=>{
      const playing=playButton.getAttribute('aria-pressed')==='true';
      quickPlay.disabled=playButton.disabled;quickPlay.textContent=playing?'Ⅱ':'▶';
      quickPlay.setAttribute('aria-label',playing?'시간 재생 정지':'시간 재생 시작');quickPlay.setAttribute('aria-pressed',String(playing));
    };
    new MutationObserver(syncPlay).observe(playButton,{attributes:true,attributeFilter:['aria-pressed','disabled']});syncPlay();
    return {sync({summary,playable}){summaryText=summary;syncSummary();quickPlay.hidden=!playable;syncPlay();}};
  }};
})(window);
