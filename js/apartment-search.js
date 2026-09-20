/* One lazy worker per document, shared by sale and rental search fields. */
(() => {
  'use strict';
  const version='20260920-search1',pending=new Map();let worker,workerReady=false,seq=0,bindingId=0;
  const css=document.createElement('link');css.rel='stylesheet';css.href='/css/apartment-search.css?v='+version;document.head.append(css);
  function failWorker(message){worker?.terminate();worker=null;workerReady=false;for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error(message));}pending.clear();}
  async function request(action,values={}){
    if(!worker){worker=new Worker('/js/apartment-search-worker.bundle.js?v='+(window.__NODESTREAM_RELEASE__||version),{type:'module'});
      worker.onmessage=({data})=>{const p=pending.get(data.id);if(!p)return;pending.delete(data.id);clearTimeout(p.timer);if(!data.error)workerReady=true;data.error?p.reject(Error(data.error)):p.resolve(data);};
      worker.onerror=()=>failWorker('자동완성을 시작하지 못했습니다. 기존 검색은 계속 사용할 수 있습니다.');
    }
    const id=++seq;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject,timer:setTimeout(()=>failWorker('자동완성 응답이 지연되고 있습니다.'),45000)});worker.postMessage({id,action,version:window.__NODESTREAM_RELEASE__||version,...values});});
  }
  const region=value=>({'41':0,'11':1,'28':2,gyeonggi:0,seoul:1,incheon:2})[value] ?? (['0','1','2'].includes(String(value))?Number(value):'');
  function scopeOf(options){const s=options.scope?.()||{};return {r:region(s.r),g:Array.isArray(s.g)?s.g:String(s.g||'').split(',').filter(Boolean)};}
  function inScope(c,s){return (s.r===''||c.r===s.r)&&(!s.g.length||s.g.includes(c.g));}
  function bind(input,options={}){
    if(!input || input._aptSearch)return input?._aptSearch;
    const fieldKey=input.id||((input.closest('form')?.id||'search')+':'+input.name);
    const id='apt-search-'+(++bindingId),popup=document.createElement('div'),list=document.createElement('div'),message=document.createElement('div'),notice=document.createElement('p');
    popup.className='apt-search-popup';popup.hidden=true;list.id=id;list.setAttribute('role','listbox');list.setAttribute('aria-label','단지 검색 후보');
    message.className='apt-search-feedback';message.setAttribute('role','status');popup.append(list,message);document.body.append(popup);
    notice.className='apt-search-notice';notice.id=id+'-notice';notice.hidden=true;notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');
    (options.noticeTarget || input.closest('form') || (input.parentElement.tagName==='LABEL'?input.parentElement.parentElement:input.parentElement)).append(notice);
    input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-haspopup','listbox');input.setAttribute('aria-controls',id);input.setAttribute('aria-expanded','false');input.setAttribute('autocomplete','off');
    if(!input.labels?.length && !input.getAttribute('aria-label'))input.setAttribute('aria-label','단지 검색');
    input.setAttribute('aria-describedby',[input.getAttribute('aria-describedby'),notice.id].filter(Boolean).join(' '));
    let selected=null,keys=new Set(),rows=new Set(),results=[],active=-1,timer,revision=0,composing=false,lastScope='',restoring=null;
    const enabled=()=>options.enabled?.()!==false;
    function announce(text){notice.textContent=text;notice.hidden=!text;}
    function close(){popup.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');active=-1;}
    function position(){if(popup.hidden)return;const r=input.getBoundingClientRect(),viewport=document.documentElement.clientWidth||innerWidth,width=Math.min(Math.max(r.width,320),viewport-16);popup.style.width=width+'px';popup.style.left=Math.max(8,Math.min(r.left,viewport-width-8))+'px';const space=innerHeight-r.bottom-12;popup.style.maxHeight=Math.max(120,Math.min(420,space>=150?space:r.top-12))+'px';popup.style.top=space>=150?r.bottom+4+'px':'auto';popup.style.bottom=space>=150?'auto':innerHeight-r.top+4+'px';}
    function open(){if(document.activeElement!==input || !enabled())return;popup.hidden=false;input.setAttribute('aria-expanded','true');position();}
    function urlSelection(value,push=false){const u=new URL(location.href);if(value)u.searchParams.set('searchApt',value);else u.searchParams.delete('searchApt');if(u.href!==location.href)history[push?'pushState':'replaceState'](history.state,'',u);}
    function assign(c){selected=c;keys=new Set([...(c?.keys||[]),...(c?.mapIds||[])]);rows=new Set(c?.rows||[]);}
    function clear({notify=true,url=true}={}){++revision;clearTimeout(timer);close();const had=!!selected;assign(null);if(url&&enabled())urlSelection(null);announce('');if(had&&notify)options.onClear?.();}
    function checkScope(){if(!enabled()){close();return true;}const scope=scopeOf(options),signature=JSON.stringify(scope);if(lastScope===signature)return true;lastScope=signature;++revision;close();
      const target=new URLSearchParams(location.search).get('searchApt');if(target&&selected&&target!==selected.id)return true;
      if(target&&!selected&&restoring)queueMicrotask(restore);
      if(selected&&!inScope(selected,scope)){clear({notify:false});input.value='';announce('선택한 단지가 변경한 지역 범위를 벗어나 선택을 해제했습니다.');options.onClear?.();return false;}return true;
    }
    function setActive(n){active=n;[...list.children].forEach((el,i)=>el.setAttribute('aria-selected',String(i===active)));if(active>=0){input.setAttribute('aria-activedescendant',id+'-'+active);list.children[active]?.scrollIntoView({block:'nearest'});}else input.removeAttribute('aria-activedescendant');}
    function labelName(target,c){const chars=[...c.name];let from=0;for(const [a,b]of c.highlights||[]){target.append(document.createTextNode(chars.slice(from,a).join('')));const mark=document.createElement('mark');mark.textContent=chars.slice(a,b).join('');target.append(mark);from=b;}target.append(document.createTextNode(chars.slice(from).join('')));}
    function choose(c){if(!enabled())return;history.replaceState({...history.state,nodoSearchQuery:{...history.state?.nodoSearchQuery,[fieldKey]:input.value}},'',location.href);++revision;clearTimeout(timer);assign(c);input.value=c.name;close();announce(c.name+' 선택됨');urlSelection(c.id,true);options.onSelect?.(c,{restore:false});}
    function failure(error){results=[];list.replaceChildren();message.replaceChildren(document.createTextNode(error.message+' '));const b=document.createElement('button');b.type='button';b.textContent='자동완성 재시도';b.onclick=()=>{input.focus();if(new URLSearchParams(location.search).has('searchApt')&&!selected)restore();else if(input.value.trim())run();else request('prepare').then(()=>announce('자동완성을 사용할 수 있습니다.')).catch(failure);};message.append(b);if(input.value.trim())open();announce(error.message+' ');const retry=b.cloneNode(true);retry.onclick=b.onclick;notice.append(retry);}
    async function run(){
      if(composing||!enabled())return;checkScope();const query=input.value.trim(),serial=++revision,started=performance.now(),prepared=workerReady;
      if(!query){close();return;}
      results=[];active=-1;input.removeAttribute('aria-activedescendant');list.replaceChildren();message.textContent='단지 검색 중…';open();
      try{const reply=await request('search',{query,scope:scopeOf(options)});if(serial!==revision||composing)return;
        results=reply.result;list.replaceChildren();message.textContent=results.length ? results.length+'개 후보 · 방향키로 이동, Enter로 선택' : '검색 결과가 없습니다. 선택한 지역·시군구를 확인해 주세요.';
        results.forEach((c,i)=>{const el=document.createElement('div');el.id=id+'-'+i;el.className='apt-search-option';el.setAttribute('role','option');el.setAttribute('aria-selected','false');const name=document.createElement('strong');const district=document.createElement('span');district.className='apt-search-district';district.textContent=c.g+' · ';name.append(district);labelName(name,c);const sub=document.createElement('span');const duplicate=results.some(other=>other!==c&&other.name===c.name&&other.g===c.g&&other.d===c.d);sub.textContent=[c.d,duplicate?(c.addresses.join(' · ')||'원천 '+(c.saleIds[0]||c.rentalIds[0])):''].filter(Boolean).join(' · ');el.append(name,sub);el.onpointerdown=e=>{if(e.pointerType!=='touch')e.preventDefault();};el.onclick=()=>choose(c);list.append(el);});
        popup.dataset.queryMs=reply.ms.toFixed(2);popup.dataset.prepareMs=reply.prepareMs.toFixed(2);popup.dataset.version=reply.version;open();requestAnimationFrame(()=>requestAnimationFrame(()=>{if(serial===revision){popup.dataset.displayMs=(performance.now()-started).toFixed(2);popup.dataset.warm=String(prepared);}}));
      }catch(error){if(serial===revision)failure(error);}
    }
    function schedule(){++revision;clearTimeout(timer);close();if(input.value.trim()&&!composing&&enabled())timer=setTimeout(run,150);}
    async function restore(){
      if(!enabled())return;const key=new URLSearchParams(location.search).get('searchApt');
      if(!key){if(selected){input.value=history.state?.nodoSearchQuery?.[fieldKey]??options.queryFromURL?.()??'';clear({url:false});}return;}
      if(selected?.id===key || restoring?.key===key&&restoring.serial===revision)return;const serial=++revision;restoring={key,serial};
      try{const {result:c}=await request('lookup',{key});if(serial!==revision || new URLSearchParams(location.search).get('searchApt')!==key)return;
        if(!c){clear();announce('이 단지를 검색 목록에서 찾을 수 없습니다. 다시 검색해 주세요.');options.onClear?.();return;}
        if(!inScope(c,scopeOf(options))){clear({notify:false});input.value='';announce('선택한 단지가 현재 지역 범위를 벗어나 선택을 해제했습니다.');options.onClear?.();return;}
        assign(c);input.value=c.name;announce(c.name+' 선택됨');options.onSelect?.(c,{restore:true});
      }catch(error){if(serial===revision){announce(error.message);failure(error);}}finally{if(restoring?.serial===serial)restoring=null;}
    }
    input.addEventListener('input',()=>{if(!enabled())return;clear({notify:false});options.onEdit?.();schedule();},true);
    input.addEventListener('compositionstart',()=>{composing=true;++revision;clearTimeout(timer);close();});
    input.addEventListener('compositionend',()=>{composing=false;schedule();});
    input.addEventListener('focus',()=>{if(!enabled())return;checkScope();if(new URLSearchParams(location.search).has('searchApt')&&!selected)restore();else if(input.value.trim())schedule();else request('prepare').catch(failure);});
    input.addEventListener('keydown',e=>{if(composing||e.isComposing)return;if(e.key==='Escape'&&!popup.hidden){e.preventDefault();e.stopImmediatePropagation();++revision;close();return;}if(popup.hidden)return;
      if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();e.stopImmediatePropagation();if(results.length)setActive(e.key==='ArrowDown'?Math.min(active+1,results.length-1):Math.max(active-1,-1));}
      else if(e.key==='Enter'&&active>=0){e.preventDefault();e.stopImmediatePropagation();choose(results[active]);}
    },true);
    document.addEventListener('pointerdown',e=>{if(e.target!==input&&!popup.contains(e.target)){++revision;close();}});
    window.addEventListener('scroll',position,true);window.addEventListener('resize',position);
    window.addEventListener('popstate',()=>{++revision;setTimeout(restore,0);});
    document.addEventListener('change',()=>{if(enabled())queueMicrotask(checkScope);});
    document.addEventListener('nodo-search-context',()=>{if(enabled())restore();else {++revision;close();}});
    input.closest('form')?.addEventListener('reset',()=>{clear({notify:false});++revision;close();});
    const api={get selected(){return enabled()?selected:null;},get ids(){return enabled()&&selected?selected.keys:null;},restore,clear,checkScope,close,
      matches(row){if(!selected)return true;return keys.has(row.as||row.sourceId||row.id||row.publicId||row.publicationId) || row.i!=null&&rows.has(row.i) || row.si?.some(i=>rows.has(i)) || !!row.memberSources?.some(s=>keys.has(s.id));},
      reportCount(n){if(selected&&enabled())announce(n===0?'단지는 있으나 현재 조회 조건에 맞는 거래가 없습니다':(options.selectionMessage?.(selected)||selected.name+' 선택됨'));},
      refresh(){checkScope();schedule();}
    };
    input._aptSearch=api;lastScope=JSON.stringify(scopeOf(options));return api;
  }
  window.addEventListener('pagehide',()=>failWorker('페이지가 닫혔습니다.'));
  window.NodoApartmentSearch={bind,region,params(){const id=new URLSearchParams(location.search).get('searchApt');return id?{searchApt:id}:{};}};
})();
