/* Map display and pointer rules. Price calculations live in map-pricing.js. */
(function(root) {
  const pricing = root.NodoMapPricing;
  if (!pricing) throw new Error("Load map-pricing.js before map-model.js");
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
  // Move only the price label; parcel coordinates and identities stay unchanged.
  function labelPosition(complex,map) {
    const center=map.latLngToContainerPoint(complex.coord),bounds=complex.displayBounds||complex.parcelBounds;
    let y=center.y-36;
    if(bounds?.length===2&&bounds.flat().every(Number.isFinite)){
      const top=map.latLngToContainerPoint([bounds[1][0],complex.coord[1]]);
      const bottom=map.latLngToContainerPoint([bounds[0][0],complex.coord[1]]);
      const height=bottom.y-top.y;
      if(height>0)y=Math.min(y,top.y+Math.max(26,Math.min(40,height*.22)));
    }
    return map.containerPointToLatLng([center.x,y]);
  }
  const api = {...pricing, regionLevel, regionClickable, geometryContains, bindMapTap, createTapGuard, labelPosition};
  root.NodoMapModel = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
