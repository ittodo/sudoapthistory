import {EOK,RULES,makeScenario,compareYears,nextYearInput} from './holding-tax.js';

const $=id=>document.getElementById(id),controls=$('tax-controls');
const money=x=>(x/10000).toLocaleString('ko-KR',{minimumFractionDigits:1,maximumFractionDigits:1});
const exact=x=>Math.round(x).toLocaleString('ko-KR')+'원';
const eok=x=>(x/EOK).toLocaleString('ko-KR',{maximumFractionDigits:4});
const marketPercent=(tax,value,s,next=false)=>s.basis==='market'&&value*(next?1+s.growth/100:1)>0?`<small class="market-percent">시세 대비 ${(tax/(value*(next?1+s.growth/100:1))*100).toFixed(3)}%</small>`:'<small class="market-percent">시세 미입력·0원</small>';
const signed=x=>(x>0?'+':'')+money(x);
const num=(form,name)=>Number(form.elements.namedItem(name).value);
const checked=(form,name)=>form.elements.namedItem(name).checked;
const names={single:'1주택 단독명의',joint:'부부 공동명의 일반',special:'부부 공동명의 특례',two:'2주택 단독명의',three:'3주택 단독명의'};
let rows=[],selected=null,lastSettings=null;
function settings(){
  const basis=controls.elements.basis.value,mode=controls.elements.mode.value;
  const joint=['joint','special'].includes(mode),single=['single','joint','special'].includes(mode);
  for(const label of document.querySelectorAll('[data-ratio]')){label.hidden=basis!=='market';label.querySelector('input').disabled=basis!=='market';}
  for(const label of document.querySelectorAll('[data-joint]')){label.hidden=!joint;label.querySelector('input').disabled=!joint;}
  for(const label of document.querySelectorAll('[data-special]')){label.hidden=mode!=='special';label.querySelector('select').disabled=mode!=='special';}
  document.querySelector('[data-single]').hidden=!single;
  $('growth-label').textContent=basis==='market'?'내년 시세 변동률 (%)':'내년 공시가격 변동률 (%)';
  const count=mode==='two'?2:mode==='three'?3:1,residence=controls.elements.residenceHouse;
  for(const option of residence.options)option.disabled=Number(option.value)>=count;
  if(Number(residence.value)>=count)residence.value='0';
  return {basis,mode,applyNextCaps:checked(controls,'applyNextCaps'),policy:controls.elements.policy.value,residenceHouse:Number(residence.value),residenceYears:num(controls,'residenceYears'),spouseResidenceYears:num(controls,'spouseResidenceYears'),ratio:num(controls,'ratio'),nextRatio:num(controls,'nextRatio'),growth:num(controls,'growth'),age:num(controls,'age'),years:num(controls,'years'),spouseAge:num(controls,'spouseAge'),spouseYears:num(controls,'spouseYears'),share:num(controls,'share'),specialOwner:num(controls,'specialOwner'),singleHousehold:single&&checked(controls,'singleHousehold'),urban:checked(controls,'urban')};
}
function showError(id,error){$(id).hidden=!error;$(id).textContent=error?.message||'';}
function render(){
  selected=null;$('tax-detail').hidden=true;rows=[];
  try{
    const s=settings();
    if(!controls.checkValidity())throw Error('가격·현실화율·공제 조건의 입력 범위를 확인해주세요.');
    const start=Math.round(num(controls,'start')*EOK),end=Math.round(num(controls,'end')*EOK),step=Math.round(num(controls,'step')*EOK);
    if(end<start)throw Error('끝 가격은 시작 가격 이상이어야 합니다.');
    if(step<=0||Math.floor((end-start)/step)+1>250)throw Error('한 번에 최대 250개 가격을 비교할 수 있습니다. 범위 또는 간격을 조정해주세요.');
    for(let value=start;value<=end;value+=step){const inputs=makeScenario(value,s);rows.push({value,inputs,...compareYears(inputs.current,inputs.next)});}
    lastSettings=s;
    $('scenario-description').textContent=s.policy==='reform'?'9월 1일 수정 정부안으로 계산합니다. 국회 확정 전의 가정이며, 재산세 한시 특례·비율은 2026년 유지 가정입니다. 현실화율과 시세 변동률은 직접 조정할 수 있습니다.':'2026년 세율·공제·한시 특례가 유지된다는 가정입니다. 개편안은 적용하지 않습니다.';
    $('tax-table').querySelector('thead').innerHTML=`<tr><th rowspan="2" scope="col">올해 ${s.basis==='market'?'시세':'공시가격'}<br>(억원)</th><th colspan="4" scope="colgroup">2026 올해</th><th colspan="6" scope="colgroup" class="group-next">2027 내년 예상 · ${s.policy==='reform'?'개편안 적용':'현행 유지 가정'}</th><th colspan="2" scope="colgroup">연간 증감</th></tr><tr>${['공시가 (억원)','재산세¹','종부세²','보유세 합계','공시가 (억원)','재산세¹','종부세²',s.applyNextCaps?'상한 후 합계':'보유세 합계','상한 전 합계','상한 감소액','금액','비율'].map((t,i)=>`<th scope="col" class="${i>=4&&i<=9?'group-next ':''}${[4,10].includes(i)?'boundary':''}">${t}</th>`).join('')}</tr>`;
    $('tax-table').querySelector('tbody').innerHTML=rows.map((r,i)=>`<tr data-index="${i}"><th scope="row"><button type="button" class="price-button" data-row="${i}" aria-expanded="false" aria-controls="tax-detail" aria-label="${eok(r.value)}억원 상세 계산">${eok(r.value)}억 <span aria-hidden="true">↗</span></button></th><td>${eok(r.current.assessed)}</td><td>${money(r.current.propertyTotal)}</td><td>${money(r.current.creTotal)}</td><td class="total">${money(r.current.total)}${marketPercent(r.current.total,r.value,s)}</td><td class="boundary">${eok(r.next.assessed)}</td><td>${money(r.next.propertyTotal)}</td><td>${money(r.next.creTotal)}</td><td class="total">${money(r.next.total)}${marketPercent(r.next.total,r.value,s,true)}</td><td>${money(r.uncappedNext.total)}</td><td>${money(r.capSavings)}</td><td class="boundary ${r.delta>0?'rise':r.delta<0?'fall':''}">${signed(r.delta)}</td><td>${r.percent==null?'—':(r.percent>0?'+':'')+r.percent.toFixed(1)+'%'}</td></tr>`).join('');
    $('table-assumptions').textContent=`${names[s.mode]} · ${s.residenceHouse<0?'비거주':`주택 ${s.residenceHouse+1} 거주`} · ${s.mode==='two'||s.mode==='three'?'총가격을 주택별 균등 배분 · ':''}${s.basis==='market'?`현실화율 ${s.ratio}% → ${s.nextRatio}% · `:''}가격 변동률 ${s.growth}% · ${s.applyNextCaps?'올해 상한 전 → 내년 상한 적용':'두 해 상한 미적용'} · 지역자원시설세 제외`;
    $('tax-status').textContent=`${rows.length}개 가격 비교 · ¹ 재산세 본세 + 도시지역분 + 지방교육세  ² 종부세 + 농어촌특별세 · 세액은 만원 단위 소수 첫째 자리로 표시합니다. 시세 대비 비율 = 해당 연도 보유세 ÷ 해당 연도 시세 (내년 가격 변동 반영). 공시가 직접 입력은 시세 비율을 표시하지 않습니다.`;
    $('download-tax').disabled=false;showError('tax-error',null);
  }catch(error){rows=[];$('tax-table').querySelector('tbody').replaceChildren();$('tax-status').textContent='입력값을 수정하면 표가 다시 계산됩니다.';$('download-tax').disabled=true;showError('tax-error',error);}
}
function input(name,value,{min=0,max=100000000000000,step='any',optional=false,label=name}={}){
  return `<input type="number" name="${name}" aria-label="${label}" min="${min}" max="${max}" step="${step}" value="${value??''}" ${optional?'placeholder="미입력"':'required'}>`;
}
function openDetail(index){
  const r=rows[index];if(!r)return;selected=r;
  document.querySelectorAll('#tax-table tbody tr').forEach(tr=>{const active=Number(tr.dataset.index)===index;tr.classList.toggle('selected',active);tr.querySelector('button').setAttribute('aria-expanded',String(active));});
  $('detail-title').textContent=`${eok(r.value)}억원 · ${names[lastSettings.mode]}`;
  const joint=r.inputs.current.owners.length===2;
  $('detail-form').innerHTML=`<div class="holding-fields"><label>거주 주택 (두 해 동일)<select name="detailResidence">${[[-1,'보유 주택에 거주하지 않음'],...r.inputs.current.houses.map((_,i)=>[i,`주택 ${i+1} 거주`])].map(([value,label])=>`<option value="${value}" ${value===r.inputs.current.residenceHouse?'selected':''}>${label}</option>`).join('')}</select></label></div><div class="holding-detail-table"><table><caption>주택별 공시가격·지분</caption><thead><tr><th>주택</th><th>2026 공시가 (억원)</th><th>2027 공시가 (억원)</th>${joint?'<th>본인 지분 (%)</th>':''}<th>도시지역분</th></tr></thead><tbody>${r.inputs.current.houses.map((h,i)=>`<tr><th>주택 ${i+1}</th><td>${input('price'+i,h.assessed/EOK,{label:`주택 ${i+1} 올해 공시가격`,max:10000})}</td><td>${input('nextPrice'+i,r.inputs.next.houses[i].assessed/EOK,{label:`주택 ${i+1} 내년 공시가격`,max:10000})}</td>${joint?`<td>${input('share'+i,h.shares[0]*100,{label:'본인 지분',min:.01,max:99.99})}</td>`:''}<td><select name="urban${i}" aria-label="주택 ${i+1} 도시지역분"><option value="yes" ${h.urban?'selected':''}>적용</option><option value="no" ${!h.urban?'selected':''}>미적용</option></select></td></tr>`).join('')}</tbody></table></div>
    <div class="holding-fields">${r.inputs.current.owners.map((o,i)=>`<label>${i?'배우자':'본인'} 만 나이${input('detailAge'+i,o.age,{max:129,step:1,label:'만 나이'})}</label><label>${i?'배우자':'본인'} 보유기간 (만 년)${input('detailYears'+i,o.years,{max:129,step:1,label:'보유기간'})}</label><label>${i?'배우자':'본인'} 2027 거주기간 (만 년)${input('detailResidenceYears'+i,r.inputs.next.owners[i].residenceYears,{max:130,step:1,label:`${i?'배우자':'본인'} 내년 거주기간`})}</label>`).join('')}<label>2026 지역자원시설세 (원)${input('resource',null,{optional:true,step:1,label:'올해 지역자원시설세'})}</label><label>2027 지역자원시설세 예상 (원)${input('nextResource',null,{optional:true,step:1,label:'내년 지역자원시설세'})}</label></div>
    <div class="holding-checks"><label><input name="nextCaps" type="checkbox" ${r.inputs.next.applyCaps?'checked':''}> 2027 상한 적용 · 상세의 올해 계산액 기준</label></div>
    <p class="holding-muted">2027 거주기간은 위 입력값을 그대로 사용합니다. 내년 상한은 올해 주택·명의를 계속 유지하는 조건입니다.</p>
    <details class="holding-detail-rules"><summary>2026 상한·재산세 경과규정 입력</summary>
      <div class="holding-checks"><label><input name="caps" type="checkbox"> 2026 과세표준·세부담 상한 적용</label></div>
      <p class="holding-muted">2026 상한을 켜면 아래 2025년 자료를 사용합니다. 2027 상한은 위 체크박스로 별도 선택하며, 아래 재산세 경과규정 해당 여부도 반영합니다. 누락 자료는 0원으로 간주하지 않습니다. 전년도 세액상당액은 고지 총액이 아닌 해당 주택·소유자의 비교용 금액입니다. 취득·멸실·증축·명의 변경이 있는 경우 이 연속 보유 계산을 사용할 수 없습니다.</p>
      <div class="holding-detail-table"><table><caption>2026년 상한 계산용 주택별 전년도 자료</caption><thead><tr><th>주택</th><th>2025 공시가 (억원)</th><th>2022년까지 과세</th><th>2025 본세 상당액 (원)</th><th>2025 도시지역분 상당액 (원)</th></tr></thead><tbody>${r.inputs.current.houses.map((h,i)=>`<tr><th>주택 ${i+1}</th><td>${input('prevPrice'+i,null,{optional:true,max:10000,label:`주택 ${i+1} 전년도 공시가격`})}</td><td><select name="legacy${i}" aria-label="주택 ${i+1} 세부담 상한 경과규정"><option value="no">해당 없음</option><option value="yes">해당</option></select></td><td>${input('prevMain'+i,null,{optional:true,step:1,label:`주택 ${i+1} 전년도 본세 상당액`})}</td><td>${input('prevCity'+i,null,{optional:true,step:1,label:`주택 ${i+1} 전년도 도시지역분 상당액`})}</td></tr>`).join('')}</tbody></table></div>
      <div class="holding-fields">${r.inputs.current.owners.map((o,i)=>`<label>${i?'배우자':'본인'} 2025 총세액상당액 (원)${input('prevEquivalent'+i,null,{optional:true,step:1,label:`${i?'배우자':'본인'} 전년도 종부세 상한용 총세액상당액`})}</label>`).join('')}</div>
      <p class="holding-muted">총세액상당액 = 종부세 상한 비교용 재산세 본세 + 종부세 (도시지역분·지방교육세·농특세 제외). 공동명의 특례는 선택한 납세의무자 칸에 합산 비교용 금액을 입력하세요. 내년 종부세 비교용 금액은 올해의 세부담 상한 차감 전 금액을 다시 산정합니다.</p>
    </details>`;
  $('tax-detail').hidden=false;renderDetail();$('tax-detail').scrollIntoView({block:'start',behavior:'smooth'});
}
function renderDetail(){
  if(!selected)return;
  const form=$('detail-form'),optional=(name,factor=1)=>form.elements.namedItem(name).value.trim()===''?null:num(form,name)*factor;
  try{
    if(!form.checkValidity())throw Error('상세 입력값의 범위를 확인해주세요.');
    const current=structuredClone(selected.inputs.current);
    current.residenceHouse=num(form,'detailResidence');current.applyCaps=checked(form,'caps');current.resourceTax=optional('resource');
    current.houses.forEach((h,i)=>{h.assessed=Math.round(num(form,'price'+i)*EOK);h.urban=form.elements.namedItem('urban'+i).value==='yes';if(h.shares.length===2){const share=num(form,'share'+i)/100;h.shares=[share,1-share];}h.previousAssessed=optional('prevPrice'+i,EOK);h.previousMain=optional('prevMain'+i);h.previousCity=optional('prevCity'+i);h.legacyCap=form.elements.namedItem('legacy'+i).value==='yes';});
    current.owners.forEach((o,i)=>{o.age=num(form,'detailAge'+i);o.years=num(form,'detailYears'+i);o.previousEquivalent=optional('prevEquivalent'+i);});
    const next=nextYearInput(current,current.houses.map((h,i)=>Math.round(num(form,'nextPrice'+i)*EOK)),{resourceTax:optional('nextResource'),policy:selected.inputs.next.policy});
    next.applyCaps=checked(form,'nextCaps');
    next.owners.forEach((o,i)=>o.residenceYears=num(form,'detailResidenceYears'+i));
    const c=compareYears(current,next);renderDetailOutput(c,current,next);showError('detail-error',null);
  }catch(error){$('detail-output').replaceChildren();showError('detail-error',error);}
}
const detailRows=(a,b,items)=>items.map(([label,key])=>`<tr><th scope="row">${label}</th><td>${exact(a[key])}</td><td>${exact(b[key])}</td></tr>`).join('');
function renderDetailOutput(c,current,next){
  const a=c.current,b=c.next;
  const rows=detailRows(a,b,[['재산세 본세','main'],['도시지역분','city'],['지방교육세','education'],['종합부동산세','cre'],['농어촌특별세','rural'],['지역자원시설세 (입력분)','resource'],['연간 합계','total']]);
  const owners=a.comprehensive.map((o,i)=>`<details class="holding-detail-rules"><summary>${i?'배우자':'본인'} 종부세 계산 과정</summary><div class="holding-detail-table"><table><thead><tr><th>항목</th><th>2026</th><th>2027 예상</th></tr></thead><tbody>${detailRows(o,b.comprehensive[i],[['종부세 합산 공시가격','assessed'],['기본공제','deduction'],['과세 진입 기준 (초과 시)','threshold'],['과세표준','base'],['누진세액','gross'],['공제할 재산세액','overlap'],['연령·기간 세액공제','credit'],['상한·절사 전 종부세','beforeCap'],['납부 종부세','tax'],['농어촌특별세','rural']])}<tr><th>종부세 공정시장가액비율</th><td>${o.ratio*100}%</td><td>${b.comprehensive[i].ratio*100}%</td></tr><tr><th>세액공제 금액 한도</th><td>없음</td><td>${Number.isFinite(b.comprehensive[i].creditLimit)?exact(b.comprehensive[i].creditLimit):'없음'}</td></tr><tr><th>연령·기간 공제율</th><td>${Math.round(o.creditRate*100)}%</td><td>${Math.round(b.comprehensive[i].creditRate*100)}%</td></tr></tbody></table></div></details>`).join('');
  const houses=a.property.map((p,i)=>`<tr><th>주택 ${i+1}</th><td>${exact(p.rawBase)}</td><td>${exact(p.base)}</td><td>${exact(b.property[i].rawBase)}</td><td>${exact(b.property[i].base)}</td></tr>`).join('');
  let jointComparison='';
  if(current.owners.length===2&&current.singleHousehold){
    jointComparison=`<div class="holding-detail-table"><table><caption>같은 가격·지분에서 공동명의 일반·특례 비교 (상한 적용 전, 지역자원시설세 제외)</caption><thead><tr><th>방식</th><th>2026 합계</th><th>2027 예상 합계</th></tr></thead><tbody>${[['일반 · 인별 과세',false,0],['특례 · 본인 선택',true,0],['특례 · 배우자 선택',true,1]].map(([label,jointSpecial,specialOwner])=>{const config={jointSpecial,specialOwner,applyCaps:false,resourceTax:null};const v=compareYears({...current,...config},{...next,...config});return `<tr><th>${label}</th><td>${exact(v.current.total)}</td><td>${exact(v.next.total)}</td></tr>`;}).join('')}</tbody></table></div>`;
  }
  $('detail-output').innerHTML=`<div class="holding-detail-totals"><div><small>2026 연간 보유세</small><strong>${money(a.total)}만원</strong><small>월 환산 ${money(a.total/12)}만원</small></div><div><small>2027 예상 연간 보유세</small><strong>${money(b.total)}만원</strong><small>월 환산 ${money(b.total/12)}만원</small></div><div><small>연간 증감</small><strong>${signed(c.delta)}만원</strong><small>${c.percent==null?'올해 세액 0원 · 증감률 없음':(c.percent>0?'+':'')+c.percent.toFixed(1)+'%'}</small></div></div>
    <div class="holding-detail-table"><table><caption>2027 상한 효과 · 원 단위</caption><thead><tr><th>항목</th><th>상한 전</th><th>선택 결과</th><th>감소액</th></tr></thead><tbody>${[['재산세·도시지역분·교육세','propertyTotal'],['종부세·농특세','creTotal'],['연간 합계','total']].map(([label,key])=>`<tr><th>${label}</th><td>${exact(c.uncappedNext[key])}</td><td>${exact(b[key])}</td><td>${exact(c.uncappedNext[key]-b[key])}</td></tr>`).join('')}</tbody></table></div>
    <div class="holding-detail-table"><table><caption>세목별 내역 · 원 단위</caption><thead><tr><th>항목</th><th>2026</th><th>2027 예상</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="holding-detail-table"><table><caption>주택별 재산세 과세표준</caption><thead><tr><th>주택</th><th>2026 상한 전</th><th>2026 적용</th><th>2027 상한 전</th><th>2027 적용</th></tr></thead><tbody>${houses}</tbody></table></div>
    <div class="holding-detail-table"><table><caption>소유자별 합계 · 지역자원시설세 제외</caption><thead><tr><th>소유자</th><th>2026</th><th>2027 예상</th></tr></thead><tbody>${a.ownerTotals.map((o,i)=>`<tr><th>${i?'배우자':'본인'}</th><td>${exact(o.property+o.cre)}</td><td>${exact(b.ownerTotals[i].property+b.ownerTotals[i].cre)}</td></tr>`).join('')}</tbody></table></div>
    ${jointComparison}${owners}<div class="holding-muted">${[a,b].map(r=>`<p><strong>${r.year} 적용 상태</strong>: ${r.notes.length?r.notes.join(' · '):'입력 자료로 상한 및 지역자원시설세 반영'}</p>`).join('')}</div>`;
}
function csv(){
  const lines=[['가격 기준',lastSettings.basis==='market'?'시세':'공시가격','보유 유형',names[lastSettings.mode]],['2027',lastSettings.policy==='reform'?'2026.9.1 수정 정부안 적용 가정 (미확정)':'2026년 세율·공제·한시 특례 유지 가정',lastSettings.applyNextCaps?'올해 상한 전 / 내년 상한 적용 (올해 계산액 기준)':'상한 미적용','지역자원시설세 제외','거주 주택',lastSettings.residenceHouse<0?'없음':lastSettings.residenceHouse+1,'2026 본인 거주기간',lastSettings.residenceYears,'2026 배우자 거주기간',lastSettings.spouseResidenceYears],['올해 현실화율(%)',lastSettings.ratio,'내년 현실화율(%)',lastSettings.nextRatio,'가격 변동률(%)',lastSettings.growth],['올해 기준가격(원)','2026 공시가격(원)','2026 재산세 등(원)','2026 종부세 등(원)','2026 보유세(원)','2027 공시가격(원)','2027 재산세 등(원)','2027 종부세 등(원)','2027 보유세(원)','2027 상한 전 보유세(원)','상한 감소액(원)','증감액(원)','증감률(%)','2026 시세대비(%)','2027 시세대비(%)'],...rows.map(r=>[r.value,r.current.assessed,r.current.propertyTotal,r.current.creTotal,r.current.total,r.next.assessed,r.next.propertyTotal,r.next.creTotal,r.next.total,r.uncappedNext.total,r.capSavings,r.delta,r.percent??'',lastSettings.basis==='market'&&r.value>0?r.current.total/r.value*100:'',lastSettings.basis==='market'&&r.value*(1+lastSettings.growth/100)>0?r.next.total/(r.value*(1+lastSettings.growth/100))*100:''])];
  const blob=new Blob(['\ufeff'+lines.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='보유세_2026_2027_시나리오.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
controls.addEventListener('submit',e=>e.preventDefault());controls.addEventListener('input',render);
$('detail-form').addEventListener('submit',e=>e.preventDefault());$('detail-form').addEventListener('input',renderDetail);
$('tax-table').addEventListener('click',e=>{const button=e.target.closest('[data-row]');if(button)openDetail(Number(button.dataset.row));});
$('reset-tax').addEventListener('click',()=>{controls.reset();render();});$('download-tax').addEventListener('click',csv);
$('close-detail').addEventListener('click',()=>{$('tax-detail').hidden=true;const active=document.querySelector('.price-button[aria-expanded=true]');if(active){active.setAttribute('aria-expanded','false');active.focus();}document.querySelector('#tax-table .selected')?.classList.remove('selected');selected=null;});
const sourceLabels={proposal:'재정경제부 · 2026.8.3 개편안 상세본 (60~64쪽)',revision:'재정경제부 · 2026.9.1 수정 정부안 (비거주 공제·상한 수정)',nts:'국세청 · 세율·공제·계산식',joint:'국세청 · 2026 공동명의 특례 납세의무자 선택',ratio:'지방세법 시행령 · 2026 공정시장가액비율',baseCap:'지방세법 · 과세표준 상한',transition:'국회예산정책처 · 2026 대한민국 조세 (재산세 경과규정)',realization:'국토교통부 · 2026 공동주택 현실화율'};
$('tax-sources').innerHTML=Object.entries(RULES.sources).map(([key,url])=>`<li><a href="${url}" target="_blank" rel="noopener noreferrer">${sourceLabels[key]}</a></li>`).join('');
render();
