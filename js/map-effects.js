/* A single bounded canvas; no permanent animation loop or per-trade DOM nodes. */
(function(root){
  function create(map){
    const canvas=document.createElement('canvas');canvas.className='trade-effects';canvas.setAttribute('aria-hidden','true');map.getContainer().append(canvas);
    const ctx=canvas.getContext('2d'),motion=matchMedia('(prefers-reduced-motion: reduce)');
    let frame=0,timer=0,generation=0;
    function clear(){generation++;cancelAnimationFrame(frame);clearTimeout(timer);frame=timer=0;ctx?.clearRect(0,0,canvas.width,canvas.height);canvas.hidden=true;}
    function burst(events){
      clear();if(!ctx||document.hidden||!events.length)return;
      const size=map.getSize(),scale=Math.min(devicePixelRatio||1,2),points=[];
      for(const event of events){if(!event.coord)continue;const p=map.latLngToContainerPoint(event.coord);points.push({...event,x:p.x,y:p.y});}
      const clusters=NodoDailyModel.effectClusters(points,size.x,size.y);
      canvas.dataset.count=String(clusters.length);canvas.dataset.trades=String(clusters.reduce((n,p)=>n+p.count,0));
      if(!clusters.length)return;
      canvas.width=Math.round(size.x*scale);canvas.height=Math.round(size.y*scale);canvas.style.width=size.x+'px';canvas.style.height=size.y+'px';canvas.hidden=false;
      ctx.setTransform(scale,0,0,scale,0,0);
      const began=performance.now(),serial=generation,duration=600;let lastPaint=-Infinity;
      function draw(now){
        if(serial!==generation||document.hidden){clear();return;}
        if(now-lastPaint<32){frame=requestAnimationFrame(draw);return;}lastPaint=now;
        const t=motion.matches?0:Math.max(0,Math.min(1,(now-began)/duration));
        ctx.clearRect(0,0,size.x,size.y);
        for(const p of clusters){
          const color=p.direction>0?'#ef4444':p.direction<0?'#3b82f6':'#10b981';
          const radius=motion.matches?9:7+23*t;
          ctx.globalAlpha=1-t;ctx.strokeStyle=color;ctx.lineWidth=3;ctx.beginPath();ctx.arc(p.x,p.y,radius,0,Math.PI*2);ctx.stroke();
          ctx.globalAlpha=(1-t)*.8;ctx.fillStyle=color;ctx.beginPath();ctx.arc(p.x,p.y,5,0,Math.PI*2);ctx.fill();
          ctx.globalAlpha=1-t;ctx.font='bold 12px system-ui';ctx.textAlign='center';ctx.lineWidth=3;ctx.strokeStyle='#fff';ctx.strokeText('+'+p.count,p.x,p.y-12);ctx.fillStyle='#14243a';ctx.fillText('+'+p.count,p.x,p.y-12);
        }
        ctx.globalAlpha=1;
        if(motion.matches){timer=setTimeout(clear,350);return;}
        if(t<1)frame=requestAnimationFrame(draw);else clear();
      }
      frame=requestAnimationFrame(draw);
    }
    map.on('movestart resize',clear);document.addEventListener('visibilitychange',()=>{if(document.hidden)clear();});window.addEventListener('pagehide',clear);
    return {burst,clear};
  }
  root.NodoMapEffects={create};
})(window);
