import test from 'node:test';
import assert from 'node:assert/strict';
import {acquisitionTax as a,capitalGainsTax as c,incomeTax} from '../js/transaction-tax.js';
test('ordinary acquisition thresholds and fractional percentage rounding',()=>{
  assert.equal(a({price:6e8}).total,6600000);
  assert.equal(a({price:7e8}).rate,.016667);
  assert.equal(a({price:9e8}).total,29700000);
  assert.equal(a({price:10e8,large:true}).total,35000000);
});
test('acquisition household count, region, rural and exclusion',()=>{
  assert.equal(a({price:10e8,houses:2}).rate,.03);
  assert.equal(a({price:10e8,houses:2,adjusted:true,large:true}).total,90000000);
  assert.equal(a({price:10e8,houses:3,adjusted:true,large:true}).total,134000000);
  assert.equal(a({price:10e8,houses:4,excluded:true}).rate,.03);
});
test('NTS published 10억 to 20억, 15 year comparison without expenses',()=>{
  const config={purchase:10e8,sale:20e8,years:15,houses:2};
  assert.equal(c(config).national,257010000);
  assert.equal(c({...config,saleAdjusted:true}).national,582510000);
  assert.equal(c({...config,houses:3,saleAdjusted:true}).national,682260000);
});
test('short holding boundary 1 and 2 years',()=>{
  const config={purchase:5e8,sale:6e8,houses:2};
  assert.equal(c({...config,years:.5}).national,68250000);
  assert.equal(c({...config,years:1}).national,58500000);
  assert.equal(c({...config,years:2}).national,18685000);
});
test('single house exemption, residence requirement, expensive housing proration',()=>{
  const config={purchase:10e8,sale:12e8,years:2};
  assert.equal(c(config).total,0);
  assert.ok(c({...config,acquiredAdjusted:true}).total>0);
  assert.equal(c({...config,acquiredAdjusted:true,residence:2}).total,0);
  assert.equal(c({...config,sale:15e8}).taxableGain,1e8);
});
test('special deduction begins at 3 years, caps and general deduction',()=>{
  const config={purchase:10e8,sale:20e8,residence:2};
  assert.equal(c({...config,years:2}).deductionRate,0);
  assert.equal(c({...config,years:3}).deductionRate,.2);
  assert.equal(c({...config,years:10,residence:10}).deductionRate,.8);
  assert.equal(c({...config,years:20,residence:0}).deductionRate,.3);
  assert.equal(c({...config,years:20,houses:2,saleAdjusted:true}).deductionRate,0);
});
test('losses, expenses, unused basic deduction and top bracket',()=>{
  assert.equal(c({purchase:10e8,sale:9e8,years:1}).total,0);
  assert.equal(c({purchase:10e8,sale:11e8,expenses:1e8,years:1}).total,0);
  assert.equal(c({purchase:5e8,sale:6e8,years:1,basic:0}).national,60000000);
  assert.equal(incomeTax(2e9),834060000);
});
