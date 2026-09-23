import table from './salary-tax-table.js';

// 2026 July–December regular employee. All amounts are KRW.
const down10 = value => Math.floor((value + 1e-7) / 10) * 10;
export function withholding(monthlyTaxable, family = 1, children = 0, ratio = 1) {
  if (!Number.isFinite(monthlyTaxable) || monthlyTaxable < 0 || !Number.isInteger(family) || family < 1 || family > 11 || !Number.isInteger(children) || children < 0 || children >= family || ![0.8, 1, 1.2].includes(ratio)) throw new RangeError('급여·가족 수를 확인하세요.');
  let tax = 0;
  if (monthlyTaxable >= 10_000_000) {
    tax = table.baseTenMillion[family - 1];
    const m = monthlyTaxable;
    if (m > 87_000_000) tax += 31_034_600 + (m - 87_000_000) * .45;
    else if (m > 45_000_000) tax += 13_394_600 + (m - 45_000_000) * .42;
    else if (m > 30_000_000) tax += 7_394_600 + (m - 30_000_000) * .4;
    else if (m > 28_000_000) tax += 6_610_600 + (m - 28_000_000) * .98 * .4;
    else if (m > 14_000_000) tax += 1_397_000 + (m - 14_000_000) * .98 * .38;
    else if (m > 10_000_000) tax += 25_000 + (m - 10_000_000) * .98 * .35;
  } else {
    const row = table.rows.find(r => monthlyTaxable >= r[0] * 1000 && monthlyTaxable < r[1] * 1000);
    tax = row ? row[family + 1] : 0;
  }
  const childCredit = children === 0 ? 0 : children === 1 ? 20_830 : 45_830 + (children - 2) * 33_330;
  return down10(Math.max(0, tax - childCredit) * ratio);
}

export function calculateSalary({amount, mode = 'annual', nonTaxable = 200_000, family = 1, children = 0, ratio = 1}) {
  if (!['annual', 'monthly'].includes(mode) || !Number.isFinite(amount) || amount < 0 || !Number.isFinite(nonTaxable) || nonTaxable < 0) throw new RangeError('급여와 비과세 금액을 확인하세요.');
  const monthly = Math.round(mode === 'annual' ? amount / 12 : amount);
  if (nonTaxable > monthly) throw new RangeError('월 비과세 금액은 세전 월급보다 클 수 없습니다.');
  const taxable = monthly - nonTaxable;
  const pensionBase = Math.min(6_590_000, Math.max(410_000, Math.floor(taxable / 1000) * 1000));
  // Employee share, estimated by dropping sub-10 KRW amounts per deduction.
  const pension = monthly === 0 ? 0 : down10(pensionBase * .0475);
  const health = monthly === 0 ? 0 : down10(Math.min(9_183_480, Math.max(20_160, taxable * .0719)) / 2);
  const care = down10(health * .009448 / .0719);
  const employment = down10(taxable * .009);
  const incomeTax = withholding(taxable, family, children, ratio);
  const localTax = down10(incomeTax * .1);
  const deductions = pension + health + care + employment + incomeTax + localTax;
  return {annual: mode === 'annual' ? amount : monthly * 12, monthly, taxable, nonTaxable, pension, health, care, employment, incomeTax, localTax, deductions, net: monthly - deductions, deductionRate: monthly ? deductions / monthly * 100 : 0};
}
