(() => {
  if(!window.NodoApartmentLinks){const links=document.createElement('script');links.src='/js/apartment-links.js';document.head.append(links);}
  const memberScript=document.createElement('script');memberScript.src='/js/member-library.js';memberScript.defer=true;document.head.append(memberScript);
  'use strict';
  const path = location.pathname;
  const section = path.startsWith('/admin') ? 'admin' : path.startsWith('/div') ? 'company' : /\/(calc|savings)/.test(path) ? 'calc' : path.startsWith('/board') ? 'board' : /^\/(library|ranking)/.test(path)?'library':'housing';
  if(!document.querySelector('link[href^="/css/responsive.css"]')){const style=document.createElement('link');style.rel='stylesheet';style.href='/css/responsive.css?v=20260922-regions1';document.head.append(style);}
  document.body.dataset.siteSection=section;
  document.body.dataset.sitePage=path==='/'?'search':path.split('/').filter(Boolean)[0].replace('.html','');
  const groups = {admin:[],library:[['관심 아파트','/library/'],['저장한 계산','/library/?tab=calculations']],housing:[['단지 검색','/'],['지도','/map/'],['지역·단지 비교','/compare/'],['시장 동향','/market/'],['가격대 통계','/stats/'],['실거래가','/trades/'],['기간별 실거래','/trades/daily/'],['정책','/policy.html']],company:[['배당·소각','/div/'],['기업 목록','/div/stocks/']],calc:[['부동산 계산기','/calc/'],['예적금 계산기','/calc/savings.html']],board:[]};
  const same = href => path.replace(/index\.html$|\.html$/g,'').replace(/\/$/,'') === href.replace(/index\.html$|\.html$/g,'').replace(/\/$/,'');
  const anchor = (label,href,current) => `<a href="${href}"${current?' aria-current="page"':''}>${label}</a>`;
  const header = document.createElement('header');header.className='nodo-header';
  header.innerHTML=`<a class="nodo-skip" href="#nodo-content">본문으로 건너뛰기</a><div class="nodo-top"><a href="/" class="nodo-brand" aria-label="노도스트림 홈">nodo<span>stream</span></a><nav class="nodo-primary" aria-label="주 메뉴">${[['부동산','/','housing'],['기업','/div/','company'],['계산기','/calc/','calc'],['게시판','/board/','board'],['내 보관함','/library/','library']].map(([n,h,s])=>anchor(n,h,s===section)).join('')}</nav><div class="nodo-tools"><label><span class="sr-only" style="position:absolute;clip:rect(0,0,0,0)">화면 테마</span><select id="nodo-theme"><option value="system">시스템 설정</option><option value="light">라이트</option><option value="dark">다크</option></select></label><a href="/account/">계정</a></div></div>${groups[section].length?`<nav class="nodo-subnav" aria-label="${section==='housing'?'부동산':'영역'} 메뉴">${groups[section].map(([n,h])=>anchor(n,h,same(h))).join('')}</nav>`:''}`;
  document.body.prepend(header);
  const theme=document.getElementById('nodo-theme');theme.value=NodoTheme.get();theme.onchange=()=>NodoTheme.set(theme.value);
  if(path.startsWith('/map'))document.body.classList.add('nodo-map');
  const legacyTop=document.getElementById('app')?.firstElementChild;
  const main=document.querySelector('main,#app,#workspace')||document.body;
  // Rearrange existing nodes so event handlers, form IDs and saved inputs survive.
  if(section==='calc')for(const result of document.querySelectorAll('[id$="-result"],#loan-result')){
    const card=result.parentElement.matches('[id^=conv-]')?result.parentElement:result.closest('.card');if(!card||card.querySelector('.calc-split')||result.parentElement!==card)continue;
    const split=document.createElement('div'),inputs=document.createElement('div');split.className='calc-split';inputs.className='calc-inputs';
    const nodes=[...card.childNodes],at=nodes.indexOf(result);for(const node of nodes.slice(0,at))inputs.append(node);
    result.classList.add('calc-output');const placeholder=document.createElement('div');placeholder.className='calc-placeholder';placeholder.textContent='조건을 입력하고 계산하면 이곳에 결과가 표시됩니다.';split.append(inputs,result,placeholder);card.prepend(split);
  }
  const layoutRoot=path.startsWith('/board')?document.querySelector('main'):path.startsWith('/account')?document.getElementById('main-content'):null;
  if(layoutRoot){const layout=document.createElement('div'),nav=document.createElement('nav'),body=document.createElement('div');layout.className='page-layout';nav.className='page-nav';nav.setAttribute('aria-label','페이지 메뉴');body.className='page-body';
    const links=path.startsWith('/board')?[['전체 글','/board/'],['내 글·댓글','/account/']]:path.startsWith('/admin')?[['댓글 관리','#stats-area'],['단지 이용 통계','#member-admin-analytics']]:[['프로필·설정','#display-nickname'],['내 글·댓글','#member-activity'],['관심 아파트','/library/'],['저장한 계산','/library/?tab=calculations']];
    for(const [label,href] of links){const a=document.createElement('a');a.textContent=label;a.href=href;nav.append(a);}body.append(...layoutRoot.childNodes);layout.append(nav,body);layoutRoot.append(layout);
  }
  const target=document.createElement('span');target.id='nodo-content';target.tabIndex=-1;main.prepend(target);
  header.querySelector('.nodo-skip').onclick=e=>{e.preventDefault();target.focus();target.scrollIntoView();};
  const retiredNav=['/trades/contracts','/kapt-v2'];
  const navPaths=new Set(Object.values(groups).flat().map(([,h])=>h.replace(/index\.html$|\.html$/g,'').replace(/\/$/,'')));
  retiredNav.forEach(p=>navPaths.add(p));
  // Hide only duplicated navigation links in legacy headers, never links in data/results.
  for(const a of document.querySelectorAll('body a')) {
    if(a.closest('.nodo-header,.admin-heading,.apartment-hero')||a.closest('table,#dp,#detail,#detailPanel'))continue;
    const inHeader=a.closest('header,.topbar,.site-header')||legacyTop?.contains(a);
    if(inHeader && navPaths.has(new URL(a.href,location.href).pathname.replace(/index\.html$|\.html$/g,'').replace(/\/$/,'')))a.classList.add('nodo-legacy-nav');
  }
  if(!path.startsWith('/map')){const footer=document.createElement('footer');footer.className='nodo-footer';footer.innerHTML='<a href="/board/">질문·제안 게시판</a> · <a href="/privacy.html">개인정보처리방침</a> · nodostream';document.body.append(footer);}
  const stateKey=()=>'nodo:scroll:'+path+location.search+location.hash;
  const saveScroll=()=>{try{sessionStorage.setItem(stateKey(),JSON.stringify({x:scrollX,y:scrollY,parts:[...document.querySelectorAll('[id]')].filter(e=>e.scrollTop||e.scrollLeft).map(e=>[e.id,e.scrollTop,e.scrollLeft])}));}catch{}};
  document.addEventListener('click',e=>{const a=e.target.closest('a[href]');if(a){saveScroll();const u=new URL(a.href,location.href);if(u.origin===location.origin&&u.pathname.startsWith('/apartment/')&&!path.startsWith('/apartment/')){try{sessionStorage.setItem('nodoApartmentReturn',path+location.search+location.hash);}catch{}}}},true);window.addEventListener('pagehide',saveScroll);
  if(performance.getEntriesByType('navigation')[0]?.type==='back_forward'){
    let saved;try{saved=JSON.parse(sessionStorage.getItem(stateKey()));}catch{}
    if(saved){let count=0;const timer=setInterval(()=>{scrollTo(saved.x,saved.y);saved.parts.forEach(([id,t,l])=>{const e=document.getElementById(id);if(e){e.scrollTop=t;e.scrollLeft=l;}});if(++count>=40)clearInterval(timer);},250);for(const event of ['wheel','pointerdown','keydown'])window.addEventListener(event,()=>clearInterval(timer),{once:true,passive:true});}
  }
  window.NodoUI={escape:s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),toast(message){let el=document.getElementById('nodo-toast');if(!el){el=document.createElement('div');el.id='nodo-toast';el.className='nodo-toast';el.setAttribute('role','status');document.body.append(el);}el.textContent=message;el.hidden=false;clearTimeout(window._nodoToastTimer);window._nodoToastTimer=setTimeout(()=>el.hidden=true,4500);}};
  if(window.Chart){
    const bindings=new WeakMap();
    Chart.register({id:'nodo-theme',beforeUpdate(chart){
      const style=getComputedStyle(document.documentElement),saved=bindings.get(chart)||[];
      const seen=new WeakSet();
      function visit(obj,depth=0){if(!obj||typeof obj!=='object'||depth>10||seen.has(obj))return;seen.add(obj);
        for(const [key,value] of Object.entries(obj)){if(typeof value==='string'&&/^var\(--[\w-]+\)$/.test(value)){if(!saved.some(r=>r.obj===obj&&r.key===key))saved.push({obj,key,token:value.slice(4,-1)});}else if(typeof value==='object')visit(value,depth+1);}
      }
      visit(chart.config._config.options);visit(chart.config._config.data);
      for(const binding of saved)binding.obj[binding.key]=style.getPropertyValue(binding.token).trim();bindings.set(chart,saved);
    }});
    window.addEventListener('nodo:theme',()=>Object.values(Chart.instances).forEach(c=>c.update('none')));
  }
  if(['/','/map/','/trades/','/trades/daily/','/apartment/','/compare/','/ranking/','/stats/','/market/'].includes(location.pathname.replace(/index\.html$/,''))){
    const css=document.createElement('link');css.rel='stylesheet';css.href='/css/rental.css?v=20260922-regions1';document.head.append(css);
    const model=document.createElement('script');model.src='/js/rental-model.js?v=20260922-regions1';model.onload=()=>{const app=document.createElement('script');app.src='/js/rental-app.js?v=20260922-frame2';document.head.append(app);};document.head.append(model);
  }
})();
