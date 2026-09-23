import test from 'node:test';
import assert from 'node:assert/strict';
import {EOK,assessedPair,calculateYear,compareYears,makeScenario,nextYearInput,propertyTax,propertyRate,comprehensiveTax,creditRate,reformTax,reformCreditRate} from '../js/holding-tax.js';
import {publicAsset} from './build-cloudflare-assets.mjs';
import {buildPurgePolicy} from './cloudflare-purge-policy.mjs';
const scenario=(value,options={})=>makeScenario(value*EOK,{basis:'assessed',...options});
const one=(value,options={})=>calculateYear(scenario(value,options).current);

test('realization applies once; price growth and ratio changes are independent',()=>{
  assert.deepEqual(assessedPair(10*EOK,{ratio:69,nextRatio:75,growth:10}),[6.9*EOK,8.25*EOK]);
  assert.deepEqual(assessedPair(10*EOK,{basis:'assessed',ratio:69,nextRatio:75,growth:10}),[10*EOK,11*EOK]);
  assert.deepEqual(assessedPair(10*EOK,{growth:-100}),[6.9*EOK,0]);
  assert.throws(()=>assessedPair(-1));assert.throws(()=>assessedPair(EOK,{ratio:0}));assert.throws(()=>assessedPair(EOK,{growth:-101}));
});
test('independent worked property example: 6억 single, base 2.64억',()=>{
  const r=one(6);
  // Special rates: 30,000 + 90,000 + 228,000 = 348,000.
  assert.equal(r.property[0].base,264000000);
  assert.equal(r.main,348000);assert.equal(r.city,369600);assert.equal(r.education,69600);
  assert.equal(r.cre,0);assert.equal(r.total,787200);
});
test('independent CRE example: 20억 single, no age/holding credit',()=>{
  const r=one(20),p=r.comprehensive[0];
  // CRE base 4.8억; gross 150만 + 126만. Property = 360만 - 63만.
  // Overlap = 297만 × (4.8억 × 45% × .4%) / 297만 = 86.4만.
  assert.equal(r.main,2970000);assert.equal(r.city,1260000);assert.equal(r.education,594000);
  assert.equal(p.base,480000000);assert.equal(p.gross,2760000);assert.equal(p.overlap,864000);
  assert.equal(r.cre,1896000);assert.equal(r.rural,379200);assert.equal(r.total,7099200);
});
test('property ratio and rate boundaries, including 9억 special threshold',()=>{
  assert.equal(propertyRate(3*EOK,true),.43);assert.equal(propertyRate(3*EOK+1,true),.44);
  assert.equal(propertyRate(6*EOK,true),.44);assert.equal(propertyRate(6*EOK+1,true),.45);
  assert.equal(propertyRate(EOK,false),.6);
  assert.equal(propertyTax(60000000),60000);assert.equal(propertyTax(150000000),195000);assert.equal(propertyTax(300000000),570000);
  assert.equal(propertyTax(60000000,true),30000);assert.equal(propertyTax(150000000,true),120000);assert.equal(propertyTax(300000000,true),420000);
  assert.equal(one(9).main,787500);assert.ok(one(9.000001).main>980000);
});
test('all CRE brackets match independent cumulative amounts',()=>{
  const bounds=[3,6,12,25,50,94];
  const normal=[1500000,3600000,9600000,26500000,64000000,152000000];
  const multiple=[1500000,3600000,9600000,35600000,110600000,286600000];
  bounds.forEach((b,i)=>{assert.equal(comprehensiveTax(b*EOK,2),normal[i]);assert.equal(comprehensiveTax(b*EOK,3),multiple[i]);assert.ok(comprehensiveTax(b*EOK+10000,3)>multiple[i]);});
});
test('12억 single and 9억 personal deduction; household and joint treatment',()=>{
  assert.equal(one(12).cre,0);assert.ok(one(12.001).cre>0);
  assert.equal(one(9,{singleHousehold:false}).cre,0);assert.ok(one(9.001,{singleHousehold:false}).cre>0);
  assert.equal(one(18,{mode:'joint'}).cre,0);assert.ok(one(18.01,{mode:'joint'}).cre>0);
  const unequal=one(18,{mode:'joint',share:60});assert.ok(unequal.comprehensive[0].tax>0);assert.equal(unequal.comprehensive[1].tax,0);
  assert.equal(one(12,{mode:'special'}).cre,0);
});
test('2026 spouse selection independent of share; credit boundaries and 80% ceiling',()=>{
  for(const [age,years,expected] of [[59,4,0],[60,5,.4],[65,10,.7],[70,15,.8],[70,0,.4],[0,15,.5]])assert.equal(creditRate(age,years),expected);
  const a=one(30,{mode:'special',share:80,age:40,years:0,spouseAge:70,spouseYears:15,specialOwner:1});
  assert.equal(a.comprehensive[1].creditRate,.8);assert.equal(a.comprehensive[0].tax,0);
  const b=one(30,{mode:'joint',age:70,years:15});assert.equal(b.comprehensive[0].creditRate,0);
});
test('identical assumptions keep years equal unless an age/holding threshold is crossed',()=>{
  const p=scenario(20);assert.equal(compareYears(p.current,p.next).delta,0);
  const q=scenario(20,{age:59,years:4});assert.ok(compareYears(q.current,q.next).delta<0);
  const z=scenario(0);assert.equal(compareYears(z.current,z.next).percent,null);
});
test('base cap uses prior price with current ratio plus 5% of current raw base',()=>{
  const s=scenario(12).current;s.applyCaps=true;s.houses[0].previousAssessed=10*EOK;
  assert.equal(calculateYear(s).property[0].base,477000000);
  s.houses[0].previousAssessed=20*EOK;assert.equal(calculateYear(s).property[0].base,540000000);
  s.houses[0].previousAssessed=null;assert.equal(calculateYear(s).property[0].base,540000000);assert.match(calculateYear(s).notes.join(' '),/과표 상한 미적용/);
});
test('transitional property caps are separate from base cap and preserve explicit zero',()=>{
  const s=scenario(6).current;s.applyCaps=true;s.houses[0]={...s.houses[0],legacyCap:true,previousMain:100000,previousCity:200000};
  const r=calculateYear(s);assert.equal(r.main,110000);assert.equal(r.city,220000);assert.equal(r.education,22000);
  s.houses[0].previousMain=0;assert.equal(calculateYear(s).main,0);
});
test('CRE cap excludes urban and supplementary taxes and never becomes negative',()=>{
  const s=scenario(20).current;s.applyCaps=true;s.owners[0].previousEquivalent=2500000;
  const r=calculateYear(s);assert.equal(r.cre,780000);assert.equal(r.rural,156000);
  s.owners[0].previousEquivalent=0;assert.equal(calculateYear(s).cre,0);
  s.owners[0].previousEquivalent=null;assert.equal(calculateYear(s).cre,1896000);
});
test('next-year reference removes burden caps instead of copying last bill',()=>{
  const s=scenario(20).current;s.applyCaps=true;s.houses[0]={...s.houses[0],previousAssessed:20*EOK,legacyCap:true,previousMain:1000000,previousCity:1000000};s.owners[0].previousEquivalent=1000000;
  const next=nextYearInput(s,[21*EOK]);
  assert.equal(next.owners[0].previousEquivalent,4866000);
  assert.equal(next.houses[0].previousAssessed,20*EOK);assert.equal(next.owners[0].age,41);
});
test('portfolio sums and rounding: two/three homes, joint and special',()=>{
  for(const mode of ['single','two','three','joint','special'])for(const value of [0,3,9,12,18,20,50,150]){
    const r=one(value,{mode,share:37});
    assert.equal(r.total,r.main+r.city+r.education+r.cre+r.rural+r.resource);
    assert.equal(r.total,r.ownerTotals.reduce((n,o)=>n+o.property+o.cre,0));
    assert.equal(r.total%10,0);assert.ok(r.total>=0);assert.ok(Number.isFinite(r.total));
    assert.ok(r.comprehensive.every(o=>o.overlap<=o.actualProperty&&o.overlap<=o.gross));
  }
  const s=scenario(30,{mode:'three'}).current;s.houses[0].assessed=2*EOK;s.houses[1].assessed=8*EOK;s.houses[2].assessed=20*EOK;
  assert.notEqual(calculateYear(s).main,one(30,{mode:'three'}).main);
});
test('invalid input does not produce a plausible tax',()=>{
  const s=scenario(20).current;
  assert.throws(()=>calculateYear({...s,year:2028}));
  assert.throws(()=>calculateYear({...s,houses:[{...s.houses[0],shares:[.5]}]}));
  assert.throws(()=>calculateYear({...s,houses:[{...s.houses[0],assessed:NaN}]}));
  assert.throws(()=>calculateYear({...s,jointSpecial:true}));
  assert.throws(()=>makeScenario(EOK,{mode:'joint',share:100}));
});
test('new assets are packaged and calculator changes invalidate page cache',()=>{
  for(const path of ['calc/holding-tax.html','js/holding-tax.js','js/holding-tax-app.js','css/holding-tax.css'])assert.equal(publicAsset(path),true);
  assert.ok(buildPurgePolicy(['js/holding-tax.js']).urls.includes('https://nodostream.com/calc/holding-tax.html'));
});

const reform=(value,options={})=>calculateYear(scenario(value,{policy:'reform',...options}).next);
test('2027 revised government proposal: entry threshold differs from deduction',()=>{
  assert.equal(reform(14,{residenceHouse:-1}).cre,0);
  const nonresident=reform(14.1,{residenceHouse:-1}).comprehensive[0];
  assert.equal(nonresident.threshold,14*EOK);assert.equal(nonresident.deduction,12*EOK);
  assert.equal(nonresident.base,147000000);assert.equal(nonresident.ratio,.7);
  assert.equal(reform(14.1,{residenceHouse:0}).comprehensive[0].base,7000000);
  // Independent 20억 resident: base 4.2억, gross 234만, overlap 75.6만.
  const r=reform(20,{residenceHouse:0});
  assert.equal(r.comprehensive[0].gross,2340000);assert.equal(r.cre,1584000);
  assert.equal(r.total,6724800);
});
test('revised joint nonresident deduction is 6억 per owner, with separate 9억 gate',()=>{
  assert.equal(reform(18,{mode:'joint',residenceHouse:-1}).cre,0);
  const r=reform(20,{mode:'joint',residenceHouse:-1});
  for(const o of r.comprehensive){assert.equal(o.deduction,6*EOK);assert.equal(o.base,280000000);}
  assert.equal(reform(20,{mode:'joint',residenceHouse:0}).comprehensive[0].deduction,9*EOK);
  const unequal=reform(18,{mode:'joint',share:60,residenceHouse:-1});
  assert.ok(unequal.comprehensive[0].tax>0);assert.equal(unequal.comprehensive[1].tax,0);
  assert.equal(reform(20,{mode:'special',residenceHouse:-1}).comprehensive[0].deduction,12*EOK);
});
test('multi-home deduction weights assessed resident value, not house count',()=>{
  const s=scenario(20,{policy:'reform',mode:'two',residenceHouse:0});
  s.next.houses[0].assessed=15*EOK;s.next.houses[1].assessed=5*EOK;
  assert.equal(calculateYear(s.next).comprehensive[0].deduction,7.75*EOK);
  assert.equal(reform(20,{mode:'two',residenceHouse:0}).comprehensive[0].deduction,6.5*EOK);
  assert.equal(reform(20,{mode:'two',residenceHouse:-1}).comprehensive[0].deduction,4*EOK);
  assert.equal(reform(9,{mode:'two',residenceHouse:-1}).cre,0);
});
test('2027 staged rate schedule preserves house-count distinction until 2028',()=>{
  const bases=[3,6,12,25,50,94,100];
  const small=[1500000,3600000,11400000,30900000,80900000,199700000,220700000];
  const large=[1500000,3600000,11400000,37400000,112400000,288400000,318400000];
  bases.forEach((v,i)=>{assert.equal(Math.round(reformTax(v*EOK,2)),small[i]);assert.equal(Math.round(reformTax(v*EOK,3)),large[i]);});
});
test('2027 transitional duration credits choose higher rate and cap credit at 800만원',()=>{
  assert.equal(reformCreditRate(40,15,0),.25);assert.equal(reformCreditRate(40,15,5),.25);
  assert.equal(reformCreditRate(40,15,10),.4);assert.equal(reformCreditRate(70,15,15),.8);
  const r=reform(100,{age:70,years:15,residenceYears:15,residenceHouse:0});
  assert.equal(r.comprehensive[0].credit,8000000);
  const special=reform(100,{mode:'special',specialOwner:1,spouseAge:70,spouseYears:15,spouseResidenceYears:15,residenceHouse:0});
  assert.equal(special.comprehensive[0].tax,0);assert.equal(special.comprehensive[0].creditRate,0);
  assert.equal(special.comprehensive[1].credit,8000000);
});
test('detail carries selected proposal and credits; reform burden cap remains 150%',()=>{
  const s=scenario(30,{policy:'reform',residenceHouse:0,residenceYears:9});
  const n=nextYearInput(s.current,[30*EOK],{policy:'reform'});
  assert.equal(n.policy,'reform');assert.equal(n.owners[0].residenceYears,10);
  assert.equal(calculateYear(n).cre,calculateYear(s.next).cre);
  n.applyCaps=true;n.owners[0].previousEquivalent=4000000;
  const r=calculateYear(n);assert.equal(r.cre,Math.max(0,6000000-r.main));
  const reference=calculateYear({...n,policy:'current',applyCaps:false});
  assert.notEqual(reference.cre,r.cre);
});
test('invalid reform policy, residence selection and duration fail explicitly',()=>{
  const s=scenario(20).current;
  assert.throws(()=>calculateYear({...s,policy:'reform'}));
  assert.throws(()=>calculateYear({...s,residenceHouse:1}));
  assert.throws(()=>calculateYear({...s,owners:[{age:40,years:0,residenceYears:-1}]}));
});

test('table cap switch carries prior assessment and CRE reference, with separate before/after totals',()=>{
  const inputs=scenario(20,{policy:'reform',residenceHouse:0,growth:100,applyNextCaps:true});
  const c=compareYears(inputs.current,inputs.next);
  assert.equal(inputs.current.applyCaps,false);
  // Prior 9억 base + 5% of next 18억 base = 9.9억 (not 9억 × 1.05).
  assert.equal(c.next.property[0].base,990000000);
  // Prior main 297만 + CRE 189.6만 => cap 729.9만; next main 333만.
  assert.equal(c.next.cre,3969000);
  assert.equal(c.next.total,10144800);
  assert.equal(c.uncappedNext.total,31312800);
  assert.equal(c.capSavings,21168000);
  assert.equal(c.delta,c.next.total-c.current.total);
  const off=compareYears(inputs.current,{...inputs.next,applyCaps:false});
  assert.equal(off.next.total,c.uncappedNext.total);assert.equal(off.capSavings,0);
});
test('table caps cover ownership presets without missing previous values or changing current taxes',()=>{
  for(const mode of ['single','joint','special','two','three']){
    const on=scenario(40,{mode,policy:'reform',growth:30,applyNextCaps:true});
    const off=scenario(40,{mode,policy:'reform',growth:30});
    const c=compareYears(on.current,on.next);
    assert.deepEqual(c.current,calculateYear(off.current));
    assert.equal(c.next.notes.some(n=>n.includes('미입력')),false);
    assert.ok(c.capSavings>=0);
    assert.equal(c.next.total+c.capSavings,c.uncappedNext.total);
  }
});
