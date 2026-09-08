/* Pure map selection/filter rules, shared by browser and Node regression tests. */
(function(root) {
  function latestArea(areas) {
    return [...areas].filter(a => a.latest).sort((a,b) => b.latest[0]-a.latest[0] || a.a-b.a || a.i-b.i)[0] || null;
  }
  function range(value, low, high) {
    if (low == null && high == null) return true;
    return value != null && Number.isFinite(value) && (low == null || value >= low) && (high == null || value <= high);
  }
  function match(c, f) {
    if (f.r != null && c.r !== f.r) return null;
    if (!range(c.tu, f.uL, f.uH) || !range(c.b, f.bL, f.bH)) return null;
    const areas = c.areas.filter(a => range(a.a, f.aL, f.aH));
    if (!areas.length) return null;
    const area = latestArea(areas);
    if (!range(area ? area.latest[1]/10000 : null, f.pL, f.pH)) return null;
    return {complex:c, areas, area};
  }
  function trades(years) {
    return Object.entries(years || {}).flatMap(([year, rows]) => rows.map((t, order) => ({
      date:Number(year)*10000+t[0]*100+t[1], price:t[2], floor:t[3], flags:t[4] || 0, cancelled:t[5] || '', order
    }))).sort((a,b) => b.date-a.date || a.order-b.order);
  }
  function clusterSummary(matches) {
    const prices=matches.map(m=>m.area?.latest?.[1]).filter(p=>Number.isFinite(p)&&p>0);
    return {count:matches.length, pricedCount:prices.length,
      average:prices.length?prices.reduce((sum,p)=>sum+p,0)/prices.length:null};
  }
  const api = {latestArea, range, match, trades, clusterSummary};
  root.NodoMapModel = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
