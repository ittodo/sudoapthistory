(function(root){
  'use strict';
  const TYPES=['sale','jeonse','monthly'],REGIONS=['41','11','28'];
  const iso=n=>String(n).replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');
  // Rental-only complexes can carry a LAWD code in g. Resolve it before
  // filtering, searching or aggregating so every rental view uses one name.
  function normalizeDistricts(catalog){
    // New districts absent from the sale catalog; names from bjd_codes.json.
    const names={'41591':'화성시 만세구','41593':'화성시 효행구','41597':'화성시 동탄구'};
    for(const c of catalog){const code=/^\d{5}-/.test(c.id)?c.id.slice(0,5):null;if(code&&c.g&&!/^\d{5}$/.test(c.g))names[code]=c.g;}
    for(const c of catalog)if(names[c.g])c.g=names[c.g];
    return names;
  }
  function decode(r,catalog){return {ci:r[0],area:Number(r[1]),date:iso(r[2]),deposit:r[3],rent:r[4],contract:r[5],floor:r[6],cancelled:!!r[7],previousDate:r[8]?iso(r[8]):null,previousLow:r[9],previousHigh:r[10],historyLow:r[11],historyHigh:r[12],value:r[13],records:r[14],rateMonth:r[15],rate:r[16],id:r[17],c:catalog[r[0]]};}
  function metric(t,s){return s.type==='jeonse'?t.deposit:s.convert?t.value:t.rent;}
  function change(t,s){if(t.cancelled||s.type==='monthly'&&!s.convert)return null;const base=t.records&8?t.previousHigh:t.records&4?t.previousLow:null;return base>0?(t.value/base-1)*100:null;}
  function annual(t,s){const rate=change(t,s),base=t.records&8?t.previousHigh:t.previousLow;if(rate==null||!(base>0&&t.value>0))return null;const days=(Date.parse(t.date)-Date.parse(t.previousDate))/86400000;if(days<=0)return null;const n=Math.expm1(Math.log(t.value/base)*365.2425/days)*100;return Number.isFinite(n)?n:null;}
  function match(t,s){
    if((s.type==='jeonse')!==(t.rent===0))return false;
    if(s.region&&REGIONS[t.c.r]!==s.region)return false;
    if(s.contract!=='all'&&s.contract!==''&&s.contract!=null&&t.contract!==Number(s.contract))return false;
    if(s.district&&!(','+s.district+',').includes(','+t.c.g+','))return false;
    if(s.q&&!`${t.c.n} ${t.c.g} ${t.c.d}`.toLowerCase().includes(s.q.toLowerCase()))return false;
    for(const [field,lo,hi] of [['area','areaMin','areaMax'],['deposit','depositMin','depositMax'],['rent','rentMin','rentMax']]){
      if(s[lo]!==''&&s[lo]!=null&&t[field]<Number(s[lo]))return false;
      if(s[hi]!==''&&s[hi]!=null&&t[field]>Number(s[hi]))return false;
    }
    return true;
  }
  function category(t,s){if(s.kind==='cancelled')return t.cancelled;if(t.cancelled)return false;if(s.type==='monthly'&&!s.convert)return true;return !s.kind||s.kind==='all'||!!(t.records&({high:1,low:2,down:4,up:8,within:16}[s.kind]||0));}
  function rateFor(rates,region,month){const list=rates.rates[region]||{},keys=Object.keys(list).filter(m=>m<=month).sort();const m=keys.at(-1);return m?{month:m,value:list[m]}:null;}
  function range(day,period){const d=new Date(day+'T00:00:00Z');if(!Number.isFinite(+d))throw Error('날짜를 확인해 주세요.');let a=new Date(d),b=new Date(d);if(period==='month'){a.setUTCDate(1);b=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0));}else if(period==='week'){a.setUTCDate(a.getUTCDate()-(a.getUTCDay()+6)%7);b=new Date(a);b.setUTCDate(b.getUTCDate()+6);}return {from:a.toISOString().slice(0,10),to:b.toISOString().slice(0,10)};}
  function months(from,to){let m=from.slice(0,7),out=[];while(m<=to.slice(0,7)){out.push(m);let [y,n]=m.split('-').map(Number);if(++n===13){y++;n=1;}m=y+'-'+String(n).padStart(2,'0');}return out;}
  function normalize(p,saved={}){const get=k=>p.has(k)?p.get(k):saved[k],choose=(key,values,fallback)=>values.includes(get(key))?get(key):fallback;return {type:choose('tenure',TYPES,'sale'),convert:get('rentConvert')==='1',region:choose('rentRegion',REGIONS,''),contract:choose('rentContract',['0','1','2','all'],'all'),day:/^\d{4}-\d{2}-\d{2}$/.test(get('rentDate')||'')?get('rentDate'):'',period:choose('rentPeriod',['day','week','month'],'month'),kind:choose('rentKind',['all','up','down','within','high','low','cancelled'],'all')};}

  function cleanFilters(s,districtsByRegion){
    if(s.type==='jeonse')s.rentMin=s.rentMax='';
    if(s.type==='monthly'&&!s.convert){if(!['all','cancelled'].includes(s.kind))s.kind='all';if(['rise','drop'].includes(s.sort))s.sort='date';}
    const allowed=districtsByRegion&&(s.region?(districtsByRegion[s.region]||[]):Object.values(districtsByRegion).flat());
    s.district=[...new Set(String(s.district||'').split(',').map(n=>n.trim()).filter(n=>n&&(!allowed||allowed.includes(n))))].join(',');
    return s;
  }
  const api={TYPES,REGIONS,iso,normalizeDistricts,cleanFilters,decode,metric,change,annual,match,category,rateFor,range,months,normalize};root.NodoRental=api;
  if(typeof module!=='undefined')module.exports=api;
})(globalThis);
