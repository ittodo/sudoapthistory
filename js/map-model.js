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
  function clusterSummary(matches) {
    const prices=matches.filter(m=>!m.area?.excludeAggregate).map(m=>m.area?.latest?.[1]).filter(p=>Number.isFinite(p)&&p>0);
    return {count:matches.length, pricedCount:prices.length,
      average:prices.length?prices.reduce((sum,p)=>sum+p,0)/prices.length:null};
  }
  function regionLevel(zoom) { return zoom < 10 ? 'sido' : zoom < 13 ? 'sigungu' : zoom < 16 ? 'dong' : 'apartment'; }
  function regionClickable(zoom) { return zoom < 17; }
  function geometryContains(geometry, point) {
    const [x,y] = point;
    function ringContains(ring) {
      let inside = false;
      for (let i=0,j=ring.length-1;i<ring.length;j=i++) {
        const [ax,ay]=ring[j], [bx,by]=ring[i];
        const cross=(x-ax)*(by-ay)-(y-ay)*(bx-ax);
        if (Math.abs(cross)<1e-12 && x>=Math.min(ax,bx) && x<=Math.max(ax,bx) && y>=Math.min(ay,by) && y<=Math.max(ay,by)) return true;
        if ((ay>y)!==(by>y) && x<(bx-ax)*(y-ay)/(by-ay)+ax) inside=!inside;
      }
      return inside;
    }
    const polygons=geometry.type==='MultiPolygon'?geometry.coordinates:geometry.type==='Polygon'?[geometry.coordinates]:[];
    return polygons.some(rings=>rings.length && ringContains(rings[0]) && !rings.slice(1).some(ringContains));
  }
  // One pointer owner for region polygons, apartment polygons and price labels.
  function bindMapTap(map) {
    const tap=createTapGuard(), container=map.getContainer();
    container.addEventListener('pointerdown',e=>tap.begin(e.pointerId,e.clientX,e.clientY,e.timeStamp,e.target.closest?.('[data-map-target]')?.dataset.mapTarget,e.button),true);
    window.addEventListener('pointermove',e=>tap.move(e.pointerId,e.clientX,e.clientY),true);
    window.addEventListener('pointerup',e=>tap.end(e.pointerId,e.clientX,e.clientY,e.timeStamp),true);
    window.addEventListener('pointercancel',e=>tap.cancel(e.pointerId),true);
    window.addEventListener('blur',()=>tap.reset());
    container.addEventListener('wheel',()=>tap.cancel(),{capture:true,passive:true});
    map.on('dragstart zoomstart',()=>tap.cancel());
    return tap;
  }
  function regionGroups(matches) {
    const groups = new Map();
    for (const match of matches) for (const id of match.complex.admin || []) {
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(match);
    }
    return groups;
  }
  // A click is a short stationary primary-pointer gesture. Dragging out and back is still a drag.
  function createTapGuard() {
    const pointers = new Set();
    let current = null, ready = null;
    function cancel() { current = null; ready = null; }
    return {
      begin(id, x, y, time, target, button = 0) {
        pointers.add(id); ready = null;
        if (pointers.size !== 1 || button !== 0) { current = null; return; }
        current = {id, x, y, time, target, moved: false};
      },
      move(id, x, y) {
        if (current?.id === id && Math.hypot(x-current.x, y-current.y) > 8) current.moved = true;
      },
      end(id, x, y, time) {
        this.move(id, x, y);
        const c = current;
        pointers.delete(id);
        ready = c?.id === id && !pointers.size && !c.moved && time-c.time >= 0 && time-c.time <= 350 ? {...c, ended: time} : null;
        current = null;
      },
      cancel(id) { if (id != null) pointers.delete(id); cancel(); },
      reset() { pointers.clear(); cancel(); },
      accept(target, time) {
        const c = ready; ready = null;
        return !!c && c.target === target && time-c.ended >= 0 && time-c.ended < 700;
      }
    };
  }
  const api = {latestArea, range, match, trades, combinedTrades, monthlyTrades, clusterSummary, regionLevel, regionClickable, regionGroups, createTapGuard, bindMapTap, geometryContains};
  root.NodoMapModel = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
