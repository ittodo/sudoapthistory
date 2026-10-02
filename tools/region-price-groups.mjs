// Internal group/month receipts; public frames retain their existing schema.
import {createHash} from 'node:crypto';
const hash=x=>createHash('sha256').update(x).digest('hex');
export function saleGroupFrames(ctx,catalog,payload,shard,month,{previous=[],engine,calculate,pack,province}={}) {
 const owners=new Map(payload.d.flatMap(c=>[[c.id,c],...(c.memberSources||[]).map(s=>[s.id,c])])),groups=new Map();
 function append(row,field){const area=catalog.areas[row[0]];if(!area)throw Error('Unknown sale area');const source=catalog.complexes[area[0]];if(!source)throw Error('Unknown sale source');const owner=owners.get(source.id),id=owner?.id||source.id;
  let g=groups.get(id);if(!g){g={id,owner,source,province:owner?.r??source.r,opening:[],updates:[],identities:new Map()};groups.set(id,g);}g[field].push(row);g.identities.set(String(row[0]),[row[0],source.id,area[1]]);
 }
 for(const row of shard.opening)append(row,'opening');for(const row of shard.updates)append(row,'updates');
 const cached=new Map(previous.map(x=>[x.id,x])),records=[],stats={computedGroups:0,reusedGroups:0,decoratedGroups:0,invalidationReasons:{missing:0,inputs:0,engine:0,corrupt:0}};
 for(const g of groups.values()){
  if(province!=null&&g.province!==province)continue;
  const membership=g.owner?[g.id,g.owner.r,g.owner.admin,(g.owner.memberSources||[]).map(s=>s.id).filter(id=>[...g.identities.values()].some(v=>v[1]===id)).sort()]:[g.id,g.province,g.source.admin];
  const fingerprint=hash(JSON.stringify([engine,month,membership,[...g.identities.values()],g.opening,g.updates]));
  const old=cached.get(g.id);let frame;
  if(old?.fingerprint===fingerprint&&old.frame&&old.frameHash===hash(JSON.stringify(old.frame))){frame=old.frame;stats.reusedGroups++;}
  else {frame=calculate(ctx,catalog,{d:g.owner?[g.owner]:[]},{opening:g.opening,updates:g.updates},month);stats.computedGroups++;stats.invalidationReasons[!old?'missing':old.fingerprint===fingerprint?'corrupt':old.engine!==engine?'engine':'inputs']++;}
  records.push({id:g.id,engine,fingerprint,frameHash:hash(JSON.stringify(frame)),frame});
 }
 const cursors=records.map(r=>({frame:r.frame,offset:0,regions:new Map(r.frame.opening.regions),meta:r.frame.opening.meta}));
 const dated=shard.updates.filter(row=>province==null||catalog.complexes[catalog.areas[row[0]][0]].r===province).map(row=>ctx.NodoDailyModel.iso(row[1]));
 const days=[month+'-00',...new Set([...dated,...records.flatMap(r=>r.frame.updates.map(u=>u.day))])].sort();
 const frame=pack(days,day=>{const totals=new Map();let count=0;
  for(const c of cursors){while(c.offset<c.frame.updates.length&&c.frame.updates[c.offset].day<=day){const u=c.frame.updates[c.offset++];for(const[id,value]of u.regions){if(value===null)c.regions.delete(id);else c.regions.set(id,value);}c.meta=u.meta;}
   count+=c.meta.complexCount;for(const[id,value]of c.regions){let sum=totals.get(id);if(!sum){sum=[0,0,0];totals.set(id,sum);}for(let i=0;i<3;i++)sum[i]+=value[i];}
  }
  return {regions:[...totals],meta:{complexCount:count,count}};
 });
 return {frame,records,stats,references:[...new Set([...shard.opening,...shard.updates].map(row=>String(row[0])))]};
}

export function rentalGroupFrames(ctx,catalog,shard,month,region,type,{previous=[],engine,calculate,pack}={}) {
 // A public-owner receipt bundles source frames, never combines their prices.
 // Restore original source insertion order before summing to retain old weights,
 // point order and floating-point bytes, including cross-province approvals.
 const sources=new Map(),groups=new Map();
 for(const field of ['opening','updates'])for(const row of shard[field]){
  if((row[4]>0)!==(type==='monthly'))continue;
  const c=catalog[row[0]];if(!c)throw Error('Unknown rental complex');let source=sources.get(row[0]);
  if(!source){source={ci:row[0],complex:c,opening:[],updates:[]};sources.set(row[0],source);
   const id=c.publicId?'public:'+c.publicId:'source:'+c.id;let group=groups.get(id);
   if(!group){group={id,members:[]};groups.set(id,group);}group.members.push(source);
  }source[field].push(row);
 }
 const cached=new Map(previous.map(x=>[x.id,x])),records=[],frames=new Map(),stats={computedGroups:0,reusedGroups:0,decoratedGroups:0,invalidationReasons:{missing:0,inputs:0,engine:0,corrupt:0}};
 for(const g of groups.values()){
  const pointMeta=JSON.stringify(g.members.map(m=>{const c=m.complex;return c.coord&&(c.admin||[]).length!==3?[m.ci,c.coord,c.n,c.publicId]:null;}));
  const fingerprint=hash(JSON.stringify([engine,month,type,region,g.id,g.members.map(m=>[m.ci,m.complex.id,m.complex.r,m.complex.admin,!!m.complex.coord,m.opening,m.updates])]));
  const old=cached.get(g.id);let frame;
  if(old?.fingerprint===fingerprint&&old.frame&&Array.isArray(old.frame.members)&&old.frame.members.length===g.members.length&&old.frameHash===hash(JSON.stringify(old.frame))){
   frame=old.frame;stats.reusedGroups++;
   if(old.pointMeta!==pointMeta){
    const decorate=p=>{const c=catalog[p.ci];return {...p,id:c.id,coord:c.coord,name:c.n,publicId:c.publicId,admin:c.admin||[]};};
    const points=rows=>rows.map(([id,p])=>[id,p===null?null:decorate(p)]);
    frame={members:frame.members.map(m=>({...m,frame:{...m.frame,opening:{...m.frame.opening,points:points(m.frame.opening.points)},updates:m.frame.updates.map(u=>({...u,points:points(u.points)}))}}))};stats.decoratedGroups++;
   }
  }else{
   frame={members:g.members.map(m=>({ci:m.ci,frame:calculate(ctx,catalog,{opening:m.opening,updates:m.updates},month,region,type)}))};
   stats.computedGroups++;stats.invalidationReasons[!old?'missing':old.fingerprint===fingerprint?'corrupt':old.engine!==engine?'engine':'inputs']++;
  }
  records.push({id:g.id,engine,fingerprint,pointMeta,frameHash:hash(JSON.stringify(frame)),frame});
  for(const m of frame.members)frames.set(m.ci,m.frame);
 }
 const cursors=[...sources.keys()].map(ci=>{const frame=frames.get(ci);return {frame,offset:0,regions:new Map(frame.opening.regions),points:new Map(frame.opening.points),meta:frame.opening.meta};});
 const days=[month+'-00',...new Set(shard.updates.map(r=>ctx.NodoRental.iso(r[2])))].sort();
 const frame=pack(days,day=>{const totals=new Map(),points=[];let count=0,complexCount=0;const sumStats={count:0,cancelled:0,unlocated:0};
  for(const c of cursors){while(c.offset<c.frame.updates.length&&c.frame.updates[c.offset].day<=day){const u=c.frame.updates[c.offset++];for(const[id,v]of u.regions){if(v===null)c.regions.delete(id);else c.regions.set(id,v);}for(const[id,v]of u.points){if(v===null)c.points.delete(id);else c.points.set(id,v);}c.meta=u.meta;}
   count+=c.meta.count;complexCount+=c.meta.complexCount;for(const k of Object.keys(sumStats))sumStats[k]+=c.meta.stats[k];points.push(...c.points.values());
   for(const[id,v]of c.regions){let sum=totals.get(id);if(!sum){sum=Array(v.length).fill(0);totals.set(id,sum);}for(let i=0;i<v.length;i++)sum[i]+=v[i];}
  }
  return {regions:[...totals],meta:{count,complexCount,stats:sumStats,points}};
 });
 return {frame,records,stats,references:[...new Set([...shard.opening,...shard.updates].map(row=>String(row[0])))]};
}

// Bind only identities and metadata actually used by this month. Appended IDs do not
// invalidate prices in old months, while a reassigned existing ID cannot reuse them.
export function priceBindings(kind,catalog,payload,references,owners) {
 owners ||= new Map(payload.d.flatMap(c=>[[c.id,c],...(c.memberSources||[]).map(s=>[s.id,c])]));
 return references.map(key=>{
  if(kind==='sale'){
   const area=catalog.areas[key],source=area&&catalog.complexes[area[0]];
   if(!source)throw Error('Unknown cached sale identity');const owner=owners.get(source.id);
   return [key,JSON.stringify([area[0],area[1],source.id,source.r,owner?[owner.id,owner.r,owner.admin]:source.admin])];
  }
  const c=catalog[key];if(!c)throw Error('Unknown cached rental identity');
  return [key,JSON.stringify([c.id,c.publicId||null,c.r,c.admin,!!c.coord,c.coord&&(c.admin||[]).length!==3?[c.coord,c.n,c.publicId]:null])];
 });
}
