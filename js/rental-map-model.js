/* Shared state selection for live maps and packaged region summaries. */
(function(root){
function create(catalog){const M=root.NodoRental;
const mapStates=new Map();
function mapRows(region,month,day,shard){
  let state=mapStates.get(region);
  const key=row=>row[0]+':'+row[1]+':'+(row[4]>0)+':'+row[5];
  const decode=row=>shard.schema===2?{ci:row[0],area:Number(row[1]),date:M.iso(row[2]),deposit:row[3],rent:row[4],contract:row[5],value:row[6],records:row[7],rateMonth:row[8],rate:row[9],id:row[10],cancelled:false,c:catalog[row[0]]}:M.decode(row,catalog);
  if(!state||state.month!==month||state.shard!==shard){
    state={month,shard,index:0,latest:new Map(),undo:[]};
    for(const row of shard.opening)state.latest.set(key(row),decode(row));
    mapStates.set(region,state);
  }
  while(state.index>0&&M.iso(shard.updates[state.index-1][2])>day){
    const [id,previous]=state.undo.pop();state.index--;
    if(previous)state.latest.set(id,previous);else state.latest.delete(id);
  }
  while(state.index<shard.updates.length&&M.iso(shard.updates[state.index][2])<=day){
    const row=shard.updates[state.index++],id=key(row);state.undo.push([id,state.latest.get(id)]);state.latest.set(id,decode(row));
  }
  return state.latest.values();
}
function mapView(shards,regions,s){
  const points=[],complexes=new Map(),stats={count:0,cancelled:0,unlocated:0};let count=0;
  for(let i=0;i<regions.length;i++){
    if(!shards[i])continue;
    for(const t of mapRows(regions[i],s.day.slice(0,7),s.day,shards[i])){
      if(!M.match(t,s)||t.cancelled)continue;
      stats.count++;if(!t.c.coord)stats.unlocated++;
      if(!M.category(t,s))continue;count++;
      if(t.c.coord){
        if(s.compactMap){const previous=complexes.get(t.ci);if(!previous||t.date>previous.date||(t.date===previous.date&&t.id>previous.id))complexes.set(t.ci,t);}
        else points.push(point(t,s));
      }
    }
  }
  if(!s.compactMap)return {stats,count,points};
  const summaries=new Map(),convertedSettings={...s,convert:true};
  for(const t of complexes.values()){
    const value=M.metric(t,s),converted=s.bundle?M.metric(t,convertedSettings):null,equivalent=s.type==='monthly'?M.depositEquivalent(t):null;
    for(const id of t.c.admin||[]){const a=summaries.get(id)||{count:0,pricedCount:0,sum:0,convertedCount:0,convertedSum:0,depositCount:0,depositSum:0,equivalentCount:0,equivalentSum:0};a.count++;if(Number.isFinite(equivalent)&&equivalent>=0){a.equivalentCount++;a.equivalentSum+=equivalent;}if(Number.isFinite(t.deposit)&&t.deposit>=0){a.depositCount++;a.depositSum+=t.deposit;}if(Number.isFinite(value)&&value>0){a.pricedCount++;a.sum+=value;}if(Number.isFinite(converted)&&converted>0){a.convertedCount++;a.convertedSum+=converted;}summaries.set(id,a);}
    const [lat,lng]=t.c.coord,b=s.bounds;
    if((!s.bundle||(t.c.admin||[]).length!==3)&&(!b||(lat>=b.south&&lat<=b.north&&lng>=b.west&&lng<=b.east)))points.push(s.bundle?{...point(t,s),convertedValue:converted}:point(t,s));
  }
  return {stats,count,points,complexCount:complexes.size,...(s.bundle?{totals:[...summaries].map(([id,a])=>[id,[a.count,a.pricedCount,a.sum,a.convertedCount,a.convertedSum,...(s.type==='monthly'?[a.depositCount,a.depositSum,a.equivalentCount,a.equivalentSum]:[])]])}:{}),regionSummaries:[...summaries].map(([id,a])=>[id,{count:a.count,pricedCount:a.pricedCount,average:a.pricedCount?a.sum/a.pricedCount:null,...(s.type==='monthly'?{depositAverage:a.depositCount?a.depositSum/a.depositCount:null,depositEquivalentAverage:a.equivalentCount?a.equivalentSum/a.equivalentCount:null}:{})}])};
}
function point(t,s){return {ci:t.ci,id:t.c.id,admin:t.c.admin||[],area:t.area,contract:t.contract,date:t.date,coord:t.c.coord,name:t.c.n,publicId:t.c.publicId,deposit:t.deposit,rent:t.rent,value:M.metric(t,s),rate:t.rate,rateMonth:t.rateMonth,records:t.records};}

return {mapView};}
root.NodoRentalMapModel={create};
})(globalThis);
