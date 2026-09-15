/* Public contract browser. API credentials and raw responses never enter the site. */
(() => {
  'use strict';
  const REVIEW_MAP_BASE = '';
  const $ = id => document.getElementById(id);
  const money = n => n == null ? '미제공' : Number(n).toLocaleString('ko-KR', {maximumFractionDigits: 1});
  const names = {jeonse:'전세',monthly:'월세',sale:'매매',unknown:'월세 미제공'};
  const params = new URLSearchParams(location.search);
  let manifest, data = [], entity = params.get('entity') || '', page = 0, generation = 0, loaded = new Set(), requestedMonths = [];
  const cache = new Map();
  function service() { return $('property').value + '-' + ($('category').value === 'sale' ? 'sale' : 'rent'); }
  async function read(path) {
    const response = await fetch('/data/contracts/' + path);
    if (!response.ok) throw new Error('자료를 불러오지 못했습니다.');
    return response.json();
  }
  function cell(row, text) { const td = document.createElement('td'); td.textContent = text; row.append(td); return td; }
  function filtered() {
    const query = $('search').value.trim().toLocaleLowerCase(), area = $('area').value, category = $('category').value;
    return data.filter(r => (!entity || r.entityId === entity) && (!area || String(r.area) === area)
      && (category === 'all-rent' || r.category === category)
      && (!query || `${r.name} ${r.dong} ${r.jibun}`.toLocaleLowerCase().includes(query)));
  }
  function areas() {
    const previous = $('area').value;
    $('area').replaceChildren(new Option('전체 면적',''));
    [...new Set(data.filter(r => !entity || r.entityId === entity).map(r => r.area))].sort((a,b)=>a-b)
      .forEach(a=>$('area').add(new Option(`${a} ㎡`,String(a))));
    if ([...$('area').options].some(o=>o.value===previous)) $('area').value=previous;
  }
  function render() {
    const rows = filtered().sort((a,b)=>b.date.localeCompare(a.date));
    page = Math.min(page, Math.max(0, Math.ceil(rows.length/100)-1));
    $('selection').textContent = entity ? `${data.find(r=>r.entityId===entity)?.name || '선택한 단지'} · ${rows.length.toLocaleString()}건` : `거래 내역 · ${rows.length.toLocaleString()}건`;
    $('rows').replaceChildren();
    rows.slice(page*100,(page+1)*100).forEach(r=>{
      const tr = document.createElement('tr');
      if(r.cancelled) tr.className='cancelled';
      cell(tr,r.date+(r.cancelled?' (취소)':''));
      const name = cell(tr,''), button=document.createElement('button'), address=document.createElement('small');
      button.className='link';button.textContent=r.name || '건물명 미제공';button.disabled=r.identityStatus==='unresolved'||!r.name||!r.dong||!r.jibun;button.onclick=()=>{entity=r.entityId;page=0;areas();render();};
      address.textContent=`${r.dong} ${r.jibun}`;name.append(button,address);
      if(REVIEW_MAP_BASE && r.property==='officetel' && !button.disabled){
        const link=document.createElement('a');link.href=REVIEW_MAP_BASE+encodeURIComponent(r.entityId);
        link.target='_top';link.textContent='지도 연결·승인 검토 ↗';name.append(link);
      }
      cell(tr,`${r.area} / ${r.floor ?? '미제공'}`);cell(tr,names[r.category]);
      cell(tr,money(r.kind==='sale'?r.price:r.deposit));cell(tr,r.kind==='sale'?'—':money(r.monthlyRent));
      cell(tr,`${r.contractType || '미제공'} / ${r.contractTerm || '미제공'}`);
      cell(tr,r.kind==='sale'?'—':`${money(r.previousDeposit)} / ${money(r.previousMonthlyRent)}`);
      cell(tr,r.renewalRight || '미제공');$('rows').append(tr);
    });
    if(!rows.length){const tr=document.createElement('tr');cell(tr,'선택한 조건의 내역이 없습니다.').colSpan=9;$('rows').append(tr);}
    $('page').textContent=`${page+1} / ${Math.max(1,Math.ceil(rows.length/100))}`;
    $('prev').disabled=page===0;$('next').disabled=(page+1)*100>=rows.length;
    const groups=new Map();
    rows.filter(r=>!r.cancelled).forEach(r=>{
      const key=r.date.slice(0,7)+'|'+r.category;
      if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);
    });
    $('trend').replaceChildren();
    const allMonths=[...new Set([...requestedMonths,...loaded])].sort().reverse();
    for(const m of allMonths){
      const categories=$('category').value==='all-rent'?['jeonse','monthly','unknown']:[$('category').value];
      for(const category of categories){
        const month=m.slice(0,4)+'-'+m.slice(4), group=groups.get(month+'|'+category)||[], tr=document.createElement('tr');
        const avg=key=>{const values=group.map(r=>r[key]).filter(v=>v!=null);return values.length?values.reduce((a,b)=>a+b,0)/values.length:null;};
        cell(tr,month);cell(tr,names[category]);cell(tr,loaded.has(m)?group.length:'미수집');
        cell(tr,group.length?money(avg(category==='sale'?'price':'deposit')):'—');
        cell(tr,category==='monthly'&&group.length?money(avg('monthlyRent')):'—');$('trend').append(tr);
      }
    }
  }
  async function load() {
    const current=new Date();
    requestedMonths=Array.from({length:12},(_,i)=>{
      const d=$('period').value==='recent'?new Date(current.getFullYear(),current.getMonth()-i,1):new Date(Number($('period').value),11-i,1);
      return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}`;
    }).filter(m=>m<=`${current.getFullYear()}${String(current.getMonth()+1).padStart(2,'0')}`);
    const token=++generation;data=[];loaded=new Set();page=0;render();
    $('status').textContent='계약 내역을 불러오는 중입니다.';
    const parts=manifest.partitions.filter(p=>p.service===service()&&p.lawd===$('district').value&&requestedMonths.includes(p.month));
    const failures=[];
    // Four simultaneous shard downloads, bounded independently of history length.
    const queue=[...parts];
    const collected=[];
    await Promise.all(Array.from({length:4},async()=>{
      while(queue.length&&token===generation){const p=queue.shift();try{
        if(!cache.has(p.path))cache.set(p.path,await read(p.path));
        collected.push([p,cache.get(p.path).rows]);
      }catch{failures.push(p.month);}}
    }));
    if(token!==generation)return;
    for(const [p,rows] of collected){data.push(...rows);loaded.add(p.month);}
    // Expose missing recent months as missing, never as zero transactions.
    for(const m of requestedMonths)if(!loaded.has(m)) failures.push(m);
    const last=parts.map(p=>p.checkedAt).sort().at(-1);
    $('status').textContent=parts.length?`${loaded.size}개월 자료 · 최근 확인 ${last?.slice(0,10)}${failures.length?' · 미수집 또는 불러오기 실패 '+[...new Set(failures)].sort().join(', '):''}`:'아직 수집된 자료가 없습니다. 수집 또는 API 이용 승인을 기다리고 있습니다.';
    areas();render();
  }
  async function init(){
    try{
      manifest=await read('index.json');
      [...new Set(manifest.partitions.map(p=>p.month.slice(0,4)))].sort().reverse().forEach(y=>$('period').add(new Option(y+'년',y)));
      Object.entries(manifest.districts).sort((a,b)=>a[1].join(' ').localeCompare(b[1].join(' '),'ko')).forEach(([id,n])=>$('district').add(new Option(n.join(' '),id)));
      if(params.has('lawd'))$('district').value=params.get('lawd');
      if(!$('district').value)$('district').selectedIndex=0;
      if(['apartment','rowhouse','officetel'].includes(params.get('property')))$('property').value=params.get('property');
      if(['all-rent','sale'].includes(params.get('category')))$('category').value=params.get('category');
      $('property').onchange=()=>{entity='';if($('property').value!=='officetel'&&$('category').value==='sale')$('category').value='all-rent';load();};
      $('category').onchange=()=>{if($('category').value==='sale'&&$('property').value!=='officetel'){entity='';$('area').value='';$('property').value='officetel';}load();};
      $('district').onchange=()=>{entity='';load();};
      $('period').onchange=load;
      $('search').oninput=()=>{page=0;render();};$('area').onchange=()=>{page=0;render();};
      $('clear').onclick=()=>{entity='';$('search').value='';$('area').value='';areas();render();};
      $('prev').onclick=()=>{page--;render();};$('next').onclick=()=>{page++;render();};
      await load();
    }catch{$('status').textContent='자료를 준비 중이거나 연결이 원활하지 않습니다. 잠시 후 다시 확인해 주세요.';}
  }
  init();
})();
