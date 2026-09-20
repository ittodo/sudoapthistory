/* A form-compatible district filter: empty means all, comma-separated names mean any. */
window.NodoDistrictPicker=select=>{
  if(!document.querySelector('link[data-district-picker]')){
    const css=document.createElement('link');css.rel='stylesheet';css.href='/css/district-picker.css?v=20260920-1';css.dataset.districtPicker='';document.head.append(css);
  }
  const label=select.closest('label'),field=document.createElement('div'),input=document.createElement('input');
  field.className=label.className+' district-field';
  const caption=document.createElement('span');caption.textContent=label.firstChild.textContent.trim()||'시·군·구';field.append(caption);
  input.type='hidden';input.name=select.name;input.value=select.value;
  if(select.hasAttribute('form'))input.setAttribute('form',select.getAttribute('form'));
  field.append(input);label.replaceWith(field);
  const details=document.createElement('details'),summary=document.createElement('summary'),panel=document.createElement('div');
  details.className='district-picker';summary.setAttribute('aria-label','시·군·구 여러 곳 선택');panel.className='district-picker-panel';
  const list=document.createElement('div'),actions=document.createElement('div'),clear=document.createElement('button'),done=document.createElement('button');
  list.className='district-picker-list';list.setAttribute('role','group');list.setAttribute('aria-label','시·군·구');actions.className='district-picker-actions';
  clear.type=done.type='button';clear.textContent='전체 해제';done.textContent='선택 완료';actions.append(clear,done);panel.append(actions,list);details.append(summary,panel);field.append(details);
  let names=[],boxes=[];
  const parse=value=>[...new Set(String(value||'').split(',').map(s=>s.trim()).filter(Boolean))];
  function setValue(value){
    const selected=parse(value).filter(n=>names.includes(n));input.value=selected.join(',');
    for(const box of boxes)box.checked=selected.includes(box.value);
    summary.textContent=selected.length===0?'전체 시·군·구':selected.length===1?selected[0]:`${selected[0]} 외 ${selected.length-1}곳`;
    summary.title=selected.length?selected.join(', '):'전체 시·군·구';
  }
  function commit(value){setValue(value);input.dispatchEvent(new Event('change',{bubbles:true}));}
  list.onchange=()=>commit(boxes.filter(b=>b.checked).map(b=>b.value).join(','));
  clear.onclick=()=>commit('');done.onclick=()=>{details.open=false;summary.focus();};
  details.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();details.open=false;summary.focus();}};
  const position=()=>{if(details.open){const x=details.getBoundingClientRect().left;panel.style.left=Math.max(12-x,Math.min(0,document.documentElement.clientWidth-12-x-panel.offsetWidth))+'px';}};
  details.addEventListener('toggle',position);window.addEventListener('resize',position);
  document.addEventListener('click',e=>{if(!details.contains(e.target))details.open=false;});
  return {input,setValue,setOptions(next,value=input.value){
    names=[...new Set(next)];boxes=[];list.replaceChildren();
    for(const name of names){const item=document.createElement('label'),box=document.createElement('input'),text=document.createElement('span');box.type='checkbox';box.value=name;text.textContent=name;item.append(box,text);list.append(item);boxes.push(box);}
    setValue(value);
  }};
};
