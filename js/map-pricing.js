/* Price selection and aggregation shared by the map and regional cache builder. */
(function(root) {
  function latestArea(areas) {
    return [...areas].filter(a => a.latest).sort((a,b) => b.latest[0]-a.latest[0] || a.a-b.a || String(a.i).localeCompare(String(b.i),'en',{numeric:true}))[0] || null;
  }
  function range(value, low, high) {
    if (low == null && high == null) return true;
    return value != null && Number.isFinite(value) && (low == null || value >= low) && (high == null || value <= high);
  }
  function match(c, f) {
    if (f.r != null && c.r !== f.r) return null;
    if (!range(c.tu, f.uL, f.uH) || !range(c.b, f.bL, f.bH)) return null;
    const areas = c.areas.filter(a => range(a.a, f.aL, f.aH));
    if (!areas.length) {
      // A located review target can have no published sale facts yet.
      // Keep it visible unless the user asks for a measured area or price.
      return !c.areas.length && ['current_review_candidate','current_review'].includes(c.scope) && [f.aL,f.aH,f.pL,f.pH].every(v=>v==null)
        ? {complex:c,areas:[],area:null} : null;
    }
    const area = latestArea(areas);
    if (!range(area ? area.latest[1]/10000 : null, f.pL, f.pH)) return null;
    return {complex:c, areas, area};
  }
  function trades(years) {
    return Object.entries(years || {}).flatMap(([year, rows]) => rows.map((t, order) => ({
      date:Number(year)*10000+t[0]*100+t[1], price:t[2], floor:t[3], flags:t[4] || 0, cancelled:t[5] || '', order
    }))).sort((a,b) => b.date-a.date || a.order-b.order);
  }
  function combinedTrades(area, datasets) {
    return area.rows.flatMap(row=>trades(datasets[row.g]?.entries?.[String(row.i)]).map(t=>({...t,sourceId:row.id,sourceName:row.n,row:row.i})))
      .sort((a,b)=>b.date-a.date || a.row-b.row || a.order-b.order);
  }
  function monthlyTrades(rows, length) {
    const sums=Array(length).fill(0), counts=Array(length).fill(0);
    for(const t of rows) {
      const year=Math.floor(t.date/10000), month=Math.floor(t.date/100)%100, index=(year-2006)*12+month-1;
      if(!(t.flags&6) && t.price>0 && index>=0 && index<length){sums[index]+=t.price;counts[index]++;}
    }
    return sums.map((sum,i)=>counts[i]?sum/counts[i]/10000:0);
  }
  function clusterTotals(matches) {
    const prices=matches.filter(m=>!m.area?.excludeAggregate).map(m=>m.area?.latest?.[1]).filter(p=>Number.isFinite(p)&&p>0);
    return {count:matches.length,pricedCount:prices.length,sum:prices.reduce((sum,p)=>sum+p,0)};
  }
  function clusterSummary(matches) {
    const s=clusterTotals(matches);return {count:s.count,pricedCount:s.pricedCount,average:s.pricedCount?s.sum/s.pricedCount:null};
  }
  function regionGroups(matches) {
    const groups = new Map();
    for (const match of matches) for (const id of match.complex.admin || []) {
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(match);
    }
    return groups;
  }
  function createPriceGroups(catalog,original,M){
    const client={catalog};let priceSignature='',priceGroups=new Map(),priceAreaOwners=new Map(),complexes=[];
    function updatePriceGroups(frame,filters){
      const signature=JSON.stringify(filters),reset=frame.reset||priceSignature!==signature;
      if(reset){priceGroups=new Map();priceAreaOwners=new Map();priceSignature=signature;}
      const dirty=new Set(),updated=[];
      function accept(state){
        const [ai,date,min,max,mean,count]=state;
        let key=priceAreaOwners.get(ai);
        if(key===false)return;
        if(key==null){
          const [ci,size]=client.catalog.areas[ai],source=client.catalog.complexes[ci];
          if(!M.match({a:Number(size),p:mean,c:source},{...filters,pL:null,pH:null})){priceAreaOwners.set(ai,false);return;}
          const base=original.get(source.id);key=base?.id||source.id;priceAreaOwners.set(ai,key);
          if(!priceGroups.has(key)){const c={...(base||source),id:key,pnus:base?.pnus||[],areas:[],dailyRows:[],areaMap:new Map()};priceGroups.set(key,c);if(!reset)complexes.push(c);}
          const c=priceGroups.get(key),area={i:ai,a:Number(size),sourceName:source.n};c.areaMap.set(ai,area);c.areas.push(area);
        }
        const c=priceGroups.get(key),a=c.areaMap.get(ai);
        a.latest=[date,mean,0,0,count];a.min=min;a.max=max;dirty.add(key);
      }
      if(reset)for(const values of frame.values)for(const state of values.values())accept(state);
      else for(const event of frame.changes)accept(event.state);
      for(const id of dirty){const c=priceGroups.get(id);c.areas.sort((a,b)=>b.latest[0]-a.latest[0]||a.a-b.a||String(a.i).localeCompare(String(b.i),'en',{numeric:true}));updated.push(c);}
      if(reset)complexes=[...priceGroups.values()];return {complexes,changed:reset?null:updated};
    }

    return {update:updatePriceGroups,owner:ai=>priceAreaOwners.get(ai)};
  }
  const api = {latestArea, range, match, trades, combinedTrades, monthlyTrades, clusterTotals, clusterSummary, regionGroups, createPriceGroups};
  root.NodoMapPricing = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
