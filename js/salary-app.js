import {calculateSalary} from './salary.js';

const form = document.querySelector('#salary-controls');
const $ = id => document.getElementById(id);
const money = value => Math.round(value).toLocaleString('ko-KR');
let rows = [];
let previousMode = 'annual';
const headers = ['세전 연봉', '세전 월급', '사회보험 합계', '소득세', '지방소득세', '월 공제 합계', '월 실수령액', '공제율(%)', '실수령액 × 12'];
const values = r => [r.annual, r.monthly, r.pension + r.health + r.care + r.employment, r.incomeTax, r.localTax, r.deductions, r.net, r.deductionRate.toFixed(2), r.net * 12];

function render() {
  const f = form.elements;
  if (f.mode.value !== previousMode) {
    const value = Number(f.amount.value);
    f.amount.value = Math.round(value * (f.mode.value === 'monthly' ? 1 / 12 : 12) * 10000) / 10000;
    previousMode = f.mode.value;
  }
  $('amount-label').textContent = `세전 ${f.mode.value === 'annual' ? '연봉' : '월급'} (만원)`;
  f.children.max = Math.max(0, Number(f.family.value) - 1);
  try {
    if (!form.checkValidity()) throw new Error('입력 범위를 확인하세요. 자녀 수는 본인을 제외한 공제대상 가족 수 이하여야 합니다.');
    const input = {amount: Number(f.amount.value) * 10000, mode: f.mode.value, nonTaxable: Number(f.nonTaxable.value) * 10000, family: Number(f.family.value), children: Number(f.children.value), ratio: Number(f.ratio.value)};
    const r = calculateSalary(input);
    $('salary-error').hidden = true;
    $('salary-results').hidden = false;
    $('salary-summary').innerHTML = `<div><small>세전 연봉</small><strong>${money(r.annual)}원</strong></div><div><small>예상 월 실수령액</small><strong>${money(r.net)}원</strong></div><div><small>월 공제 합계 · ${r.deductionRate.toFixed(2)}%</small><strong>${money(r.deductions)}원</strong></div>`;
    const items = [
      ['세전 급여', r.monthly, '비과세 포함'], ['비과세 금액 (급여에 포함)', r.nonTaxable, '공제 항목 아님'],
      ['국민연금', r.pension, '기준소득월액 × 4.75% · 상·하한 적용'], ['건강보험', r.health, '보수월액 × 3.595% · 상·하한 적용'],
      ['장기요양보험', r.care, '건강보험료 × (0.9448 ÷ 7.19)'], ['고용보험', r.employment, '보수월액 × 0.9%'],
      ['소득세', r.incomeTax, `간이세액표 · ${input.ratio * 100}%`], ['지방소득세', r.localTax, '소득세 × 10%'],
      ['공제 합계', r.deductions, '보험료 + 세금'], ['예상 실수령액', r.net, '세전 급여 − 공제 합계'],
    ];
    $('salary-breakdown').innerHTML = items.map(([label, amount, note]) => `<tr><th scope="row">${label}</th><td>${money(amount)}</td><td>${money(amount * 12)}</td><td>${note}</td></tr>`).join('');
    const salaries = new Set(Array.from({length: 27}, (_, i) => 20_000_000 + i * 5_000_000));
    salaries.add(r.annual);
    rows = [...salaries].sort((a,b) => a-b).filter(a => Math.round(a/12) >= input.nonTaxable).map(amount => calculateSalary({...input, mode: 'annual', amount}));
    $('salary-comparison').innerHTML = rows.map(row => `<tr${row.annual === r.annual ? ' class="selected"' : ''}>${values(row).map((v,i) => i === 0 ? `<th scope="row">${money(v)}${row.annual === r.annual ? ' (입력)' : ''}</th>` : `<td${i === 6 ? ' class="total"' : ''}>${i === 7 ? v + '%' : money(v)}</td>`).join('')}</tr>`).join('');
  } catch (error) {
    $('salary-error').textContent = error.message;
    $('salary-error').hidden = false;
    $('salary-results').hidden = true;
    rows = [];
  }
}
form.addEventListener('input', render);
form.addEventListener('change', render);
form.addEventListener('submit', event => event.preventDefault());
form.addEventListener('reset', () => { previousMode = 'annual'; setTimeout(render, 0); });
$('salary-csv').addEventListener('click', () => {
  const csv = '\uFEFF' + [headers, ...rows.map(values)].map(row => row.join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], {type: 'text/csv;charset=utf-8'}));
  const link = document.createElement('a'); link.href = url; link.download = '연봉별-실수령액-2026하반기.csv'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
render();
