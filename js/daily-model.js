/* Daily contracts and historical prices. Pure rules also exercised in Node. */
(function(root) {
  'use strict';
  const DAY=86400000;
  const iso=n=>String(n).replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');
  const number=s=>Number(s.replaceAll('-',''));
  const valid=s=>/^\d{4}-\d{2}-\d{2}$/.test(s||'') && Number.isFinite(Date.parse(s+'T00:00:00Z')) && new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
  function shift(s,step=1,unit='day') {
    const d=new Date(s+'T00:00:00Z');
    if(unit==='month') {const day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+step);const end=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,end));}
    else d.setUTCDate(d.getUTCDate()+step*(unit==='week'?7:1));
    return d.toISOString().slice(0,10);
  }
  function periodRange(day,period='day',min='0001-01-01',max='9999-12-31') {
    let start=day,end=day;
    if(period==='week'){start=shift(day,-((new Date(day+'T00:00:00Z').getUTCDay()+6)%7));end=shift(start,6);}
    if(period==='month'){start=day.slice(0,7)+'-01';end=shift(shift(start,1,'month'),-1);}
    return {start,end,from:start<min?min:start,to:end>max?max:end};
  }
  function monthsBetween(from,to){const result=[];for(let d=from.slice(0,7)+'-01';d.slice(0,7)<=to.slice(0,7);d=shift(d,1,'month'))result.push(d.slice(0,7));return result;}
  function range(v,lo,hi) { return (lo==null || (v!=null&&v>=lo))&&(hi==null || (v!=null&&v<=hi)); }
  // The established detail pages use Python's integer-area grouping (ties to even).
  const detailArea=n=>n%1===0.5?Math.round(n/2)*2:Math.round(n);
  function decode(row,catalog) {
    const [ai,d,p,f,flags,previousDate,previousMin,high,low,records,id]=row;
    const [ci,a]=catalog.areas[ai];
    return {ai,d,p,f,flags,previousDate,previousMin,high,low,records,id,a:Number(a),c:catalog.complexes[ci]};
  }
  function match(t,f={}) {
    return (f.r==null||t.c.r===f.r)&&(!f.g||t.c.g===f.g)&&
      (!f.q||[t.c.n,t.c.g,t.c.d].join(' ').toLowerCase().includes(f.q.toLowerCase()))&&
      range(t.a,f.aL,f.aH)&&range(t.p/10000,f.pL,f.pH)&&range(t.c.tu,f.uL,f.uH)&&range(t.c.b,f.bL,f.bH);
  }
  function category(t,kind='all') {
    if(kind==='inactive')return !!(t.flags&6);
    if(t.flags&6)return false;
    return kind==='high'?!!(t.records&1):kind==='low'?!!(t.records&2):kind==='down'?!!(t.records&4):true;
  }
  function summary(rows) {return rows.reduce((s,t)=>{if(!(t.flags&6)){s.count++;s.high+=!!(t.records&1);s.low+=!!(t.records&2);s.down+=!!(t.records&4);s.direct+=!!(t.flags&1);s.unlocated+=!t.c.coord;}else {s.inactive++;if(t.flags&2)s.cancelled++;else s.missing++;}return s;},{count:0,high:0,low:0,down:0,direct:0,unlocated:0,inactive:0,cancelled:0,missing:0});}
  function snapshot(data,day) {
    const result=new Map(data.opening.map(s=>[s[0],s]));
    for(const s of data.updates){if(s[1]>day)break;result.set(s[0],s);}
    return result;
  }
  // One cursor per active province. Forward playback visits only new updates;
  // backwards seeking rebuilds from the monthly checkpoint without future data.
  function priceCursor(data){
    let values=new Map(),offset=0,lastDay=-Infinity,eventDay=null,atDate=[];
    return {seek(day){
      const reset=day<lastDay||lastDay===-Infinity;
      if(reset){values=new Map(data.opening.map(s=>[s[0],s]));offset=0;eventDay=null;atDate=[];}
      const events=[];
      while(offset<data.updates.length&&data.updates[offset][1]<=day){
        const state=data.updates[offset++],previous=values.get(state[0]);
        const event={state,previous};events.push(event);values.set(state[0],state);
        if(eventDay!==state[1]){eventDay=state[1];atDate=[];}atDate.push(event);
      }
      lastDay=day;return {values,events,atDate:eventDay===day?atDate:[],reset};
    }};
  }
  // Cluster in screen space to bound drawing work without dropping trade counts.
  function effectClusters(points,width,height,limit=80){
    const visible=points.filter(p=>p.x>=0&&p.y>=0&&p.x<=width&&p.y<=height);
    let size=32,groups;
    do{
      groups=new Map();
      for(const p of visible){const key=Math.floor(p.x/size)+','+Math.floor(p.y/size);let g=groups.get(key);
        if(!g){g={x:0,y:0,n:0,count:0,up:0,down:0};groups.set(key,g);}
        g.x+=p.x;g.y+=p.y;g.n++;g.count+=p.count;g.up+=p.direction>0?p.count:0;g.down+=p.direction<0?p.count:0;
      }
      size*=2;
    }while(groups.size>limit);
    return [...groups.values()].map(g=>({...g,x:g.x/g.n,y:g.y/g.n,direction:g.up&&g.down?0:g.up?1:g.down?-1:0}));
  }
  function annualChange(t) {
    if(t.flags&7||!(t.p>0)||!(t.previousMin>0)||!valid(iso(t.d))||!valid(iso(t.previousDate)))return null;
    const days=(Date.parse(iso(t.d)+'T00:00:00Z')-Date.parse(iso(t.previousDate)+'T00:00:00Z'))/DAY;
    if(days<=0)return null;
    const years=days/365.2425,rate=Math.expm1(Math.log(t.p/t.previousMin)/years)*100;
    return {days,years,rate:Number.isFinite(rate)?rate:null};
  }
  function badge(t) {
    if(t.flags&2)return '해제'; if(t.flags&4)return '원천에서 사라짐';if(t.flags&1)return '직거래';
    const v=[];if(t.records&1)v.push('신고가');if(t.records&2)v.push('신저가');if(t.records&4)v.push('직전 대비 하락');
    if(t.records&8)v.push('최고가 동일');if(t.records&16)v.push('최저가 동일');if(t.records&32)v.push('첫 거래');return v.join(' · ')||'일반 거래';
  }
  function filters(params) {
    const f={};for(const k of ['r','aL','aH','pL','pH','uL','uH','bL','bH']){const s=params.get(k),v=Number(s);if(s!==null&&s!==''&&Number.isFinite(v)&&v>=0)f[k]=v;}
    if(![0,1,2].includes(f.r))delete f.r;
    for(const p of ['a','p','u','b'])if(f[p+'L']>f[p+'H'])delete f[p+'H'];
    for(const k of ['g','q'])if(params.get(k))f[k]=params.get(k).slice(0,100);return f;
  }
  const api={DAY,iso,number,valid,shift,periodRange,monthsBetween,range,detailArea,decode,match,category,summary,snapshot,priceCursor,effectClusters,annualChange,badge,filters};
  root.NodoDailyModel=api;
  if(typeof module!=='undefined')module.exports=api;
})(globalThis);
