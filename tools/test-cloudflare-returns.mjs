import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../js/calc-utils.js',import.meta.url),'utf8');
function context(overrides={}){
  const ctx=vm.createContext({
    Y:[2022,2023,2024,2025,2026],retYearFrom:2022,retYearTo:2025,
    dataLastMonth:9,PRICES:{'1':[100,0,0,133.1,0]},DI:{},...overrides
  });
  vm.runInContext(source,ctx);
  return ctx;
}
function near(actual,expected){assert.ok(Math.abs(actual-expected)<1e-9,`${actual} != ${expected}`);}

test('annual compounding reconstructs gains, losses, and partial-year returns',()=>{
  const c=context();
  near(c.compoundAnnualReturn(100,200,120),7.177346253629313);
  near(c.compoundAnnualReturn(100,121,24),10);
  near(c.compoundAnnualReturn(100,81,24),-10);
  near(c.compoundAnnualReturn(100,110,12),10);
  near(c.compoundAnnualReturn(100,110,6),21);
  near(c.compoundAnnualReturn(100,100,24),0);
  for(const args of [[0,100,12],[100,0,12],[-1,100,12],[100,100,0],[100,100,-12],[NaN,100,12],[100,Infinity,12],[100,100,NaN],[null,100,12],[1,Number.MAX_VALUE,1]]){
    assert.equal(c.compoundAnnualReturn(...args),null);
  }
});

test('selected years use compound growth instead of total growth divided by years',()=>{
  const c=context(),r=c.calcReturnObj({i:1});
  near(r.val,10);assert.equal(r.years,3);near(c.calcReturn({i:1}),10);
});

test('missing starting years use the first available year and its actual duration',()=>{
  const c=context({PRICES:{'1':[0,100,0,121,0]}}),r=c.calcReturnObj({i:1});
  near(r.val,10);assert.equal(r.years,2);
});

test('partial ending years preserve the existing month adjustment',()=>{
  const c=context({retYearFrom:2025,retYearTo:2026,dataLastMonth:6,PRICES:{'1':[0,0,0,100,110]}});
  assert.equal(c.retMonths(),6);
  const r=c.calcReturnObj({i:1});near(r.val,21);assert.equal(r.years,0.5);
});

test('missing ending prices and ranges without two price observations remain unavailable',()=>{
  for(const PRICES of [null,{}, {'1':[100,0,0,0,200]}, {'1':[0,0,0,100,0]}]){
    assert.equal(context({PRICES}).calcReturnObj({i:1}),null);
  }
  assert.equal(context({retYearFrom:2025}).calcReturnObj({i:1}),null);
});

test('merged rows weight each area compound return and skip missing observations',()=>{
  const c=context({retYearFrom:2023,PRICES:{'1':[0,100,0,121,0],'2':[0,100,0,144,0],'3':[0,100,0,0,0]},DI:{1:{u:100},2:{u:300},3:{u:900}}});
  const r=c.calcReturnObj({_merged:true,si:[1,2,3]});
  near(r.val,17.5);assert.equal(r.years,2);
});

test('region comparison renders the same compound annual return',()=>{
  const main=readFileSync(new URL('../js/main-app.js',import.meta.url),'utf8');
  const start=main.indexOf('  const metrics=[');
  const end=main.indexOf('\n  ];',start);
  assert.ok(start>=0&&end>start);
  const c=context({priceMetricMode:'total'});
  const metrics=vm.runInContext(main.slice(start,end)+'\n  ]; metrics;',c);
  const [label,getter,format]=metrics.at(-1);
  assert.equal(label,'2022→2025 연복리(%)');
  near(getter({yearAvg:[100,0,0,133.1,0]}),10);
  assert.equal(format(getter({yearAvg:[100,0,0,133.1,0]})),'10.0');
  assert.equal(getter({yearAvg:[100,0,0,0,0]}),null);
  assert.equal(getter({yearAvg:[0,100,0,121,0]}),null);
});
