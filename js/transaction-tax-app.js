import {acquisitionTax,capitalGainsTax} from './transaction-tax.js';
const root=document.getElementById('transaction-tax');
const number=(name,label,value,min=0,max=10000,step='any')=>`<label>${label}<input name="${name}" type="number" value="${value}" min="${min}" max="${max}" step="${step}" required></label>`;
const select=(name,label,options)=>`<label>${label}<select name="${name}">${options.map(([value,text])=>`<option value="${value}">${text}</option>`).join('')}</select></label>`;
const check=(name,label)=>`<label><input type="checkbox" name="${name}">${label}</label>`;
root.innerHTML=`<h2>살 때 · 팔 때 내는 세금</h2><p class="holding-muted">개인 단독명의 주택 1채의 매매 조건입니다. 위 보유세 표의 총자산·주택 수와 독립적으로 설정합니다. 취득·양도는 2026 현행 규정을 고정한 비교이며, 보유세 개편안 선택이나 미래 세법 변경을 반영하지 않습니다.</p>
<form id="transaction-form"><h3>매수 조건 · 취득세</h3><div class="holding-fields">
${number('purchase','매수 가격 (억원 · 양도세에도 사용)',10,.01)}
${select('acqHouses','취득 후 세대 주택 수',[[1,'1주택'],[2,'2주택'],[3,'3주택'],[4,'4주택 이상']])}
</div><div class="holding-checks">${check('acqAdjusted','취득 시 조정대상지역')}${check('large','국민주택규모 초과 (일반 85㎡ / 읍·면 일부 100㎡)')}${check('acqExcluded','취득세 중과 제외 요건 충족')}</div>
<p class="holding-muted">감면·생애최초·일시적 2주택·저가주택 등의 요건은 자동 판정하지 않습니다.</p>
<p id="acquisition-summary" aria-live="polite"></p>
<h3>매도 조건 · 보유 연차별 양도소득세</h3><div class="holding-fields">
${number('sale','매도 가격 (억원)',15,.01)}
${select('saleHouses','매도 시 세대 주택 수',[[1,'1세대 1주택'],[2,'2주택'],[3,'3주택 이상']])}
${select('residenceMode','거주기간 가정',[['all','보유기간 내내 거주'],['none','거주하지 않음'],['limit','아래 기간까지만 거주']])}
${number('residence','최대 거주기간 (만 년)',2,0,30,1)}
${number('expenses','기타 필요경비 (만원 · 취득세 제외)',0,0,1e8)}
${number('basic','남은 연간 기본공제 (만원)',250,0,250)}
${number('maxYears','마지막 비교 연차 (만 년)',20,2,30,1)}
</div><div class="holding-checks">${check('acquiredAdjusted','취득 당시 조정대상지역 · 비과세에 2년 거주 필요')}${check('saleAdjusted','매도 시 조정대상지역')}${check('saleExcluded','양도세 다주택 중과 제외 요건 충족')}</div></form>
<p id="sale-input-help" class="holding-muted"></p><div id="sale-summary" class="holding-detail-totals" aria-live="polite"></div>
<p class="holding-muted">매매차익은 매도 가격 − 매수 가격이며, 비용·세금 차감 전 금액입니다. 매수 가격은 위 매수 조건에서 수정합니다. 1주택 12억원 비과세·고가주택 안분을 위해 매도 가격도 함께 계산합니다. 매수 가격·매도 가격을 고정해 기간 효과를 비교합니다. 각 행은 해당 시점에 한 번 매도하는 대안입니다. 계산된 취득세·교육세·농특세를 필요경비에 자동 포함합니다. 기타 필요경비에 중복 입력하지 마세요. 거주기간은 보유기간을 넘지 않습니다.</p>
<p class="holding-muted">1세대 1주택은 보유 2년 및 해당 거주요건 충족 시 12억원까지 비과세, 초과분만 안분합니다. 장기보유특별공제는 3년부터 적용하며 거주 2년 이상인 요건 충족 1주택은 보유·거주 각각 연 4%, 합계 최대 80%입니다. 일반 공제는 연 2%, 최대 30%입니다. 조정대상지역 다주택 중과는 공제를 배제하고 20/30%p를 가산합니다. 2026년 5월 9일 종료된 중과 유예·경과계약 예외는 자동 적용하지 않습니다.</p>
<p id="transaction-error" role="alert" hidden></p><div class="holding-detail-table" id="capital-gains-table" aria-live="polite"></div>
<p class="holding-muted">각 금액에 억·만원을 표시합니다. 총세금 = 취득세 등 + 양도소득세 + 지방소득세. 취득세 등은 매수 시 한 번 납부하는 금액으로 각 매도 대안에 동일하게 포함하며, 연차별로 누적하지 않습니다. 이익 대비 총세금 = 총세금 ÷ 비용 차감 전 매매차익. 순차익 = 매도 가격 − 매수 가격 − 취득세 등 − 기타 필요경비 − 양도세·지방소득세 (보유세·금융비용 제외). 공동명의·법인·미등기·분양권·특수 비과세는 이 표의 대상이 아닙니다.</p>
<p class="holding-muted">출처: <a href="https://etax.seoul.go.kr/AcqutaxCalcAction.view" target="_blank" rel="noopener">서울시 취득세</a> · <a href="https://www.nts.go.kr/nts/cm/cntnts/cntntsView.do?cntntsId=7711&mi=2312" target="_blank" rel="noopener">국세청 양도세율</a> · <a href="https://www.nts.go.kr/nts/cm/cntnts/cntntsView.do?cntntsId=7710&mi=2311" target="_blank" rel="noopener">장기보유특별공제</a> · <a href="https://i.nts.go.kr/nts/cm/cntnts/cntntsView.do?cntntsId=8799&mi=12271" target="_blank" rel="noopener">고가주택 안분</a></p>`;
const form=document.getElementById('transaction-form'),el=id=>document.getElementById(id),n=name=>Number(form.elements.namedItem(name).value),b=name=>form.elements.namedItem(name).checked;
const money=n=>(n/1e4).toLocaleString('ko-KR',{minimumFractionDigits:1,maximumFractionDigits:1}),pct=n=>(100*n).toFixed(3)+'%';
const amount=n=>{const sign=n<0?'-':'',v=Math.abs(n),eok=Math.floor(v/1e8),rest=v-eok*1e8;return sign+(eok?`${eok.toLocaleString('ko-KR')}억 `:'')+(rest||!eok?`${money(rest)}만원`:'원');};
const table=(caption,headers,rows)=>`<table><caption>${caption}</caption><thead><tr>${headers.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map((v,i)=>i?`<td>${v}</td>`:`<th scope="row">${v}</th>`).join('')}</tr>`).join('')}</tbody></table>`;
function render(){try{
  el('sale-input-help').textContent='위 매수 조건의 매수 가격과 아래 매도 가격을 입력하세요. 매매차익은 두 가격의 차이로 자동 계산합니다.';
  if(!Number.isFinite(n('sale'))||n('sale')<.01||n('sale')>10000)throw Error('매도 가격은 0.01억 이상 10,000억 이하여야 합니다. 매도 가격 입력값을 확인해주세요.');
  if(!form.checkValidity())throw Error('매매 조건의 입력 범위를 확인해주세요.');
  const purchase=n('purchase')*1e8,sale=n('sale')*1e8,options={houses:n('acqHouses'),adjusted:b('acqAdjusted'),large:b('large'),excluded:b('acqExcluded')};
  const acq=acquisitionTax({price:purchase,...options});
  el('acquisition-summary').textContent=`취득세 ${amount(acq.main)} + 지방교육세 ${amount(acq.education)} + 농특세 ${amount(acq.rural)} = 취득세 등 ${amount(acq.total)} (매수 가격 대비 ${pct(acq.total/purchase)})`;
  const gross=sale-purchase,cost=acq.total+n('expenses')*1e4;
  el('sale-summary').innerHTML=`<div><small>매수 가격 → 매도 가격</small><strong>${purchase/1e8}억 → ${sale/1e8}억</strong><small>전 연차에 같은 가격 적용</small></div><div><small>매매차익 · 비용 차감 전</small><strong>${amount(gross)}</strong><small>매도 가격 − 매수 가격</small></div><div><small>필요경비 차감 후 차익</small><strong>${amount(gross-cost)}</strong><small>취득세 등 ${amount(acq.total)} + 기타 ${amount(n('expenses')*1e4)} 차감</small></div>`;
  const years=[.5,1,...Array.from({length:n('maxYears')-1},(_,i)=>i+2)];
  el('capital-gains-table').innerHTML=table('보유기간별 매수·매도 통합 세금표 · 취득세는 매수 시 1회',['보유기간','거주기간','매수 가격','매도 가격','매매차익','과세 구분','장특공제율','취득세 등','양도소득세','지방소득세','총세금','이익 대비 총세금','세후 순차익'],years.map(years=>{
    const mode=form.elements.residenceMode.value,residence=mode==='all'?years:mode==='none'?0:Math.min(years,n('residence'));
    const t=capitalGainsTax({purchase,sale,expenses:acq.total+n('expenses')*1e4,years,residence,houses:n('saleHouses'),acquiredAdjusted:b('acquiredAdjusted'),saleAdjusted:b('saleAdjusted'),excluded:b('saleExcluded'),basic:n('basic')*1e4});
    return [years===.5?'6개월':`만 ${years}년`,`${residence}년`,amount(purchase),amount(sale),amount(gross),t.eligible?(sale<=12e8?'비과세':'12억 초과 안분'):t.shortRate?'단기보유'+(t.surcharge?'·중과 비교':''):t.surcharge?'다주택 중과':'일반 과세',pct(t.deductionRate),amount(acq.total),amount(t.national),amount(t.local),amount(acq.total+t.total),gross>0?pct((acq.total+t.total)/gross):'—',amount(t.net)];
  }));el('transaction-error').hidden=true;
}catch(error){el('capital-gains-table').replaceChildren();el('acquisition-summary').textContent='';el('sale-summary').replaceChildren();el('transaction-error').hidden=false;el('transaction-error').textContent=error.message;}}
form.addEventListener('submit',e=>e.preventDefault());form.addEventListener('input',render);render();
