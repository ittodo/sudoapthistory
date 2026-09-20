const assert=require('node:assert/strict');
require('node:vm').runInThisContext(require('node:fs').readFileSync(require('node:path').join(__dirname,'../js/rental-model.js'),'utf8'));
const M=globalThis.NodoRental;
const districts=[{id:'11110-1',g:'종로구'},{id:'unresolved:11110:x',g:'11110'},{id:'rent-only',g:'41591'},{id:'rent-only-2',g:'41593'},{id:'rent-only-3',g:'41597'}];
const names=M.normalizeDistricts(districts);
assert.equal(names['11110'],'종로구');
assert.deepEqual(districts.map(c=>c.g),['종로구','종로구','화성시 만세구','화성시 효행구','화성시 동탄구']);
M.normalizeDistricts(districts);assert.equal(districts[1].g,'종로구');
const c=[{r:1,g:'종로구',d:'창신동',n:'테스트'}];
const row=[0,'84.00',20260917,10000,50,1,3,0,20250917,90,100,80,100,105,9,'2026-07',6,'x'];
const t=M.decode(row,c),s={type:'monthly',convert:true,contract:'all',kind:'all'};
assert.equal(M.change(t,s),5.000000000000004);
assert.equal(M.change(t,{...s,convert:false}),null);
assert.equal(M.match(t,{...s,contract:'2'}),false);
assert.equal(M.match(t,{...s,region:'41'}),false);
assert.equal(M.match(t,{...s,region:'11'}),true);
assert.equal(M.category({...t,cancelled:true},s),false);
assert.equal(M.category({...t,cancelled:true},{...s,kind:'cancelled'}),true);
assert.deepEqual(M.range('2026-09-20','week'),{from:'2026-09-14',to:'2026-09-20'});
assert.deepEqual(M.range('2024-02-12','month'),{from:'2024-02-01',to:'2024-02-29'});
assert.deepEqual(M.months('2025-12-30','2026-01-03'),['2025-12','2026-01']);
assert.equal(M.rateFor({rates:{11:{'2026-07':5,'2026-10':6}}},'11','2026-09').value,5);
assert.equal(M.rateFor({rates:{11:{'2026-07':5}}},'11','2011-01'),null);
assert.equal(M.normalize(new URLSearchParams('rentPeriod=bad&rentRegion=bad')).period,'month');
const clean=M.cleanFilters({type:'jeonse',rentMin:'100',rentMax:'200',region:'11',district:'수원시'}, {'11':['종로구']});
assert.equal(clean.rentMin,'');assert.equal(clean.rentMax,'');assert.equal(clean.district,'');
const monthly=M.cleanFilters({type:'monthly',convert:false,kind:'up',sort:'rise',rentMin:'100'});
assert.equal(monthly.kind,'all');assert.equal(monthly.sort,'date');assert.equal(monthly.rentMin,'100');
assert.equal(M.cleanFilters({type:'jeonse',region:'11',district:'종로구'}, {'11':['종로구']}).district,'종로구');
console.log('Rental model tests passed');

// Multiple districts form a union; similarly named districts must not leak in.
for(const type of ['jeonse','monthly']){
 const trade={...t,rent:type==='jeonse'?0:50};
 assert.equal(M.match(trade,{...s,type,district:'강북구,종로구'}),true);
 assert.equal(M.match(trade,{...s,type,district:'강북구,중구'}),false);
 assert.equal(M.match(trade,{...s,type,district:'종로구동'}),false);
 assert.equal(M.match(trade,{...s,type,district:''}),true);
}
assert.equal(M.cleanFilters({region:'11',district:' 종로구,수원시,종로구,강북구 '},{11:['종로구','강북구'],41:['수원시']}).district,'종로구,강북구');
assert.equal(M.cleanFilters({region:'',district:'종로구,수원시'},{11:['종로구'],41:['수원시']}).district,'종로구,수원시');
console.log('Rental district union and region pruning passed');
