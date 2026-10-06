(function(root){
  'use strict';
  const regions={'11':'서울','41':'경기','28':'인천'},codes=['41','11','28'];
  const finite=v=>typeof v==='number'&&Number.isFinite(v);
  const monthNumber=m=>Number(m.slice(0,4))*12+Number(m.slice(5,7))-1;
  const monthString=n=>Math.floor(n/12)+'-'+String(n%12+1).padStart(2,'0');
  const shift=(m,n)=>monthString(monthNumber(m)+n);
  function months(a,b){const out=[];for(let n=monthNumber(a);n<=monthNumber(b);n++)out.push(monthString(n));return out;}
  function values(row,type){const deposit=Number(row[3]),rent=Number(row[4]),rate=row[7];if(type==='jeonse')return {monthly:deposit,deposit};if(!finite(rate)||rate<=0)return {monthly:null,deposit:null};return {monthly:rent+deposit*rate/1200,deposit:deposit+rent*1200/rate};}
  function boundaries(type,metric,mode){const cash=type==='jeonse'||metric==='deposit';return mode==='simple'?(cash?[30000,50000]:[100,200]):(cash?[10000,30000,50000,100000]:[50,100,200,300]);}
  function tier(value,limits){const i=limits.findIndex(n=>value<=n);return i<0?limits.length:i;}
  function matches(row,c,s){
    if(!c||(s.type==='jeonse')!==(row[4]===0))return false;
    if(s.region&&codes[c.r]!==s.region)return false;
    if(s.contract!=='all'&&Number(s.contract)!==row[5])return false;
    if(s.gus?.length&&!s.gus.includes(c.g))return false;
    if(s.searchIds?.length){if(!s.searchIds.some(id=>[c.id,c.publicId,c.mapId].includes(id)))return false;}
    else if(s.q&&!`${c.n} ${c.g} ${c.d}`.toLocaleLowerCase().includes(s.q.toLocaleLowerCase()))return false;
    for(const [index,name] of [[1,'area'],[3,'deposit'],[4,'rent']])for(const [suffix,cmp]of [['Min',(a,b)=>a<b],['Max',(a,b)=>a>b]])if(s[name+suffix]!==''&&s[name+suffix]!=null&&cmp(Number(row[index]),Number(s[name+suffix])))return false;
    return true;
  }
  const bucket=()=>({count:0,sum:0,ppSum:0,ppCount:0});
  const metricBucket=()=>({...bucket(),prices:[],pps:[],simple:Array.from({length:3},bucket),detail:Array.from({length:5},bucket)});
  const group=()=>({count:0,excluded:0,monthly:metricBucket(),deposit:metricBucket()});
  function add(g,row,s){g.count++;const v=values(row,s.type),area=Number(row[1]);if(v.monthly==null){g.excluded++;return;}
    for(const key of ['monthly','deposit']){const m=g[key],value=v[key],pp=area>0?value*3.305785/area:null;m.count++;m.sum+=value;m.prices.push(value);if(pp!=null){m.ppSum+=pp;m.ppCount++;m.pps.push(pp);}for(const mode of ['simple','detail']){const b=m[mode][tier(value,boundaries(s.type,key,mode))];b.count++;b.sum+=value;if(pp!=null){b.ppSum+=pp;b.ppCount++;}}}
  }
  function median(a){if(!a.length)return null;a.sort((a,b)=>a-b);const n=a.length>>1;return a.length%2?a[n]:(a[n-1]+a[n])/2;}
  const finishBucket=b=>({count:b.count,sum:b.sum,avg:b.count?b.sum/b.count:null,ppCount:b.ppCount,ppAvg:b.ppCount?b.ppSum/b.ppCount:null});
  function finish(g){const out={count:g.count,excluded:g.excluded};for(const key of ['monthly','deposit']){const m=g[key];out[key]={...finishBucket(m),median:median(m.prices),ppMedian:median(m.pps),simple:m.simple.map(finishBucket),detail:m.detail.map(finishBucket)};}return out;}
  function aggregate(rows,catalog,s){const total=group(),districts={},byRegion={};for(const row of rows){const c=catalog[row[0]];if(!matches(row,c,s))continue;add(total,row,s);add(districts[c.g]??=group(),row,s);add(byRegion[codes[c.r]]??=group(),row,s);}return {total:finish(total),districts:Object.fromEntries(Object.entries(districts).map(([k,g])=>[k,finish(g)])),regions:Object.fromEntries(Object.entries(byRegion).map(([k,g])=>[k,finish(g)]))};}
  // One build-time pass; retain exact medians, never average district medians.
  function summarize(rows,catalog){
    const groups={};
    for(const row of rows){const c=catalog[row[0]];if(!c)throw Error('Unknown market complex');const type=row[4]===0?'jeonse':'monthly';
      for(const contract of ['all',String(row[5])]){const key=type+':'+contract,g=groups[key]??={total:group(),districts:{},regions:{}};
        add(g.total,row,{type});add(g.districts[c.g]??=group(),row,{type});add(g.regions[codes[c.r]]??=group(),row,{type});
      }
    }
    for(const type of ['jeonse','monthly'])for(const contract of ['all','0','1','2']){const key=type+':'+contract,g=groups[key]??={total:group(),districts:{},regions:{}};
      groups[key]={total:finish(g.total),districts:Object.fromEntries(Object.entries(g.districts).map(([k,v])=>[k,finish(v)])),regions:Object.fromEntries(Object.entries(g.regions).map(([k,v])=>[k,finish(v)]))};
    }return groups;
  }
  function summaryEligible(s){return (s.gus||[]).length<=1&&!s.searchIds?.length&&!['q','areaMin','areaMax','depositMin','depositMax','rentMin','rentMax'].some(k=>s[k]!==''&&s[k]!=null);}
  function selectSummary(groups,s){const g=groups[s.type+':'+s.contract];if(!g)throw Error('Missing market summary');const empty=finish(group());
    if(s.gus?.length){const name=s.gus[0],region=groups.districtRegions?.[name],found=(!s.region||s.region===region)?g.districts[name]:null,v=found||empty;return {total:v,districts:found?{[name]:v}:{},regions:found&&region?{[region]:v}:{}};}
    if(!s.region)return g;
    const total=g.regions[s.region]||empty;return {total,districts:Object.fromEntries(Object.entries(g.districts).filter(([name])=>groups.districtRegions?.[name]===s.region)),regions:g.regions[s.region]?{[s.region]:total}:{}};
  }
  function normalize(url,meta,saved={}){
    const p=url.searchParams,h=new URLSearchParams(url.hash.slice(1)),first=meta.months[0],last=meta.months.at(-1),get=k=>p.get(k)??saved[k];
    const type=['sale','jeonse','monthly'].includes(get('tenure'))?get('tenure'):'sale';
    const year=(v,f)=>/^\d{4}$/.test(v||'')?Math.max(+first.slice(0,4),Math.min(+last.slice(0,4),+v)):f;
    let from=year(h.get('from'),Math.max(+first.slice(0,4),+last.slice(0,4)-4)),to=year(h.get('to'),+last.slice(0,4));if(from>to)[from,to]=[to,from];
    let ref=(get('rentDate')||'').slice(0,7);if(h.has('m')&&/^\d+$/.test(h.get('m'))) {ref=monthString((meta.saleStartYear||2006)*12+Number(h.get('m')));if(h.get('mExact')!=='1'&&shift(ref,1)===last)ref=last;}
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(ref))ref=last;
    const low=[first,from+'-01'].sort().at(-1),high=[last,to+'-12'].sort()[0];ref=[low,ref,high].sort()[1];
    const region=({'seoul':'11','gyeonggi':'41','incheon':'28','all':''})[h.get('r')]??get('rentRegion')??'';
    const gus=(h.get('gu')??get('rental_district')??'').split(',').filter(Boolean).slice(0,5);
    const s={type,region:regions[region]?region:'',gus,from,to,ref,metric:get('marketRentMetric')==='deposit'?'deposit':'monthly',pm:h.get('pm')==='pyeong'?'pyeong':'total',tier:['simple','detail'].includes(h.get('tier'))?h.get('tier'):'off',contract:['0','1','2'].includes(get('rentContract'))?get('rentContract'):'all'};
    for(const k of ['q','areaMin','areaMax','depositMin','depositMax','rentMin','rentMax'])s[k]=get('rental_'+k)||'';
    if(type==='jeonse')s.rentMin=s.rentMax='';return s;
  }
  const api={regions,codes,months,shift,monthNumber,monthString,values,boundaries,tier,matches,aggregate,summarize,summaryEligible,selectSummary,normalize};root.NodoMarketRental=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
