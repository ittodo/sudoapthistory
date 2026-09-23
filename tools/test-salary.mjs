import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {calculateSalary, withholding} from '../js/salary.js';
import table from '../js/salary-tax-table.js';
import {buildSalary, salaryAssets} from './build-salary.mjs';

test('official table has complete, contiguous wage ranges and 11 family columns', () => {
  assert.equal(table.rows.length, 646);
  assert.equal(table.rows[0][0], 770);
  assert.equal(table.rows.at(-1)[1], 10000);
  table.rows.forEach((row, i) => {
    assert.equal(row.length, 13);
    assert.ok(row.every(Number.isFinite));
    if (i) assert.equal(table.rows[i-1][1], row[0]);
  });
});
test('official PDF page 13 examples and exact wage boundaries', () => {
  assert.equal(withholding(2_999_999), 73_060);
  assert.equal(withholding(3_000_000), 74_350);
  assert.equal(withholding(3_000_000, 3), 31_940);
  assert.equal(withholding(769_999), 0);
  assert.equal(withholding(9_999_999), 1_503_990);
  assert.equal(withholding(10_000_000), 1_507_400);
});
test('2026 child credit and withholding choices', () => {
  assert.equal(withholding(3_000_000, 3, 1), 11_110);
  assert.equal(withholding(3_000_000, 3, 2), 0);
  assert.equal(withholding(10_000_000, 4, 3), 1_091_680);
  assert.equal(withholding(3_000_000, 1, 0, .8), 59_480);
  assert.equal(withholding(3_000_000, 1, 0, 1.2), 89_220);
});
test('official higher salary formulas at tier boundaries', () => {
  assert.equal(withholding(14_000_000), 2_904_400);
  assert.equal(withholding(28_000_000), 8_118_000);
  assert.equal(withholding(30_000_000), 8_902_000);
  assert.equal(withholding(45_000_000), 14_902_000);
  assert.equal(withholding(87_000_000), 32_542_000);
  assert.equal(withholding(88_000_000), 32_992_000);
});
test('monthly deductions, annual/monthly input equivalence and accounting identity', () => {
  const a = calculateSalary({amount:38_400_000});
  const b = calculateSalary({amount:3_200_000,mode:'monthly'});
  assert.deepEqual(a,b);
  assert.equal(a.pension,142_500);
  assert.equal(a.health,107_850);
  assert.equal(a.care,14_170);
  assert.equal(a.employment,27_000);
  assert.equal(a.incomeTax,74_350);
  assert.equal(a.localTax,7_430);
  assert.equal(a.net,2_826_700);
  assert.equal(a.net+a.deductions,a.monthly);
});
test('insurance floors and caps apply to employee share', () => {
  const low=calculateSalary({amount:300_000,mode:'monthly',nonTaxable:200_000});
  assert.equal(low.pension,19_470);
  assert.equal(low.health,10_080);
  const high=calculateSalary({amount:200_000_000,mode:'monthly'});
  assert.equal(high.pension,313_020);
  assert.equal(high.health,4_591_740);
  assert.equal(calculateSalary({amount:0,nonTaxable:0}).net,0);
});
test('invalid inputs are rejected rather than silently clamped', () => {
  for(const input of [{amount:NaN},{amount:-1},{amount:1_000_000,nonTaxable:1_000_000},{amount:50_000_000,family:1,children:1},{amount:50_000_000,family:1.5},{amount:50_000_000,ratio:2}]) assert.throws(()=>calculateSalary(input),RangeError);
});
test('salary packaging is isolated from deployment and regional caches', () => {
  const root=mkdtempSync(join(tmpdir(),'salary-build-'));
  try {
    for(const path of salaryAssets){mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),'fixture:'+path);}
    mkdirSync(join(root,'cloudflare/dist/public'),{recursive:true});
    writeFileSync(join(root,'cloudflare/dist/public/keep.txt'),'unchanged');
    const result=buildSalary(root);
    assert.equal(result.scope,'salary-local');
    assert.equal(result.regionalCaches,'not invoked');
    assert.equal(readFileSync(join(root,'cloudflare/dist/public/keep.txt'),'utf8'),'unchanged');
    assert.ok(existsSync(join(result.output,'calc/salary.html')));
    assert.equal(JSON.parse(readFileSync(join(result.output,'local-manifest.json'))).deployable,false);
  } finally {rmSync(root,{recursive:true,force:true});}
});
