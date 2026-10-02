/* Nationwide mortgage loan average; independent of housing calculations. */
(()=>{
  'use strict';
  function month(label){const m=/^(\d{4})[-.](\d{2})$/.exec(label);return m?m[1]+'-'+m[2]:null;}
  function series(rows,labels){const map=new Map(rows.map(r=>[r.month,r]));return labels.map(label=>map.get(month(label))?.rate??null);}
  let promise;const mounts=new WeakMap();
  function load(){return promise??=fetch('/data/market-rates/mortgage.json').then(r=>{if(!r.ok)throw Error('주담대 평균금리 HTTP '+r.status);return r.json();}).then(d=>{if(d.schema!==1||d.basis!=='new-loans-target-month'||d.source!=='https://ecos.bok.or.kr'||d.statCode!=='121Y006'||d.itemCode!=='BECBLA0302'||d.unit!=='percent-per-year'||!Array.isArray(d.rows)||!d.rows.length||d.rows.some(r=>!month(r.month)||!Number.isFinite(r.rate)||r.rate<0||r.rate>30))throw Error('Invalid 주담대 평균금리 data');return d;});}
  function attach(chart){
    const canvas=chart.canvas;if(!['priceChart','mr-price'].includes(canvas.id))return;
    let state=mounts.get(canvas);
    if(!state){
      const panel=document.createElement('div');panel.className='market-mortgage';
      panel.innerHTML='<label><input type="checkbox"> 주담대 평균금리 표시</label><span role="status"></span><a href="https://ecos.bok.or.kr/" target="_blank" rel="noopener">한국은행 ECOS</a>';
      panel.style.cssText='display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:12px 0;font-size:12px;color:var(--muted)';
      canvas.parentElement.parentElement.insertBefore(panel,canvas.parentElement);
      state={panel,check:panel.querySelector('input'),status:panel.querySelector('[role=status]')};state.check.checked=true;mounts.set(canvas,state);
      state.check.onchange=()=>apply(state);
    }
    state.chart=chart;
    load().then(data=>{state.data=data;apply(state);}).catch(()=>{state.status.textContent='금리 자료를 불러오지 못했습니다. 가격 자료는 그대로 표시합니다.';});
  }
  function apply(state){
    const chart=state.chart;if(!chart?.ctx||!state.data)return;
    chart.data.datasets=chart.data.datasets.filter(d=>!d.mortgage);
    delete chart.options.scales.mortgage;
    if(state.check.checked){
      const data=series(state.data.rows,chart.data.labels);
      chart.data.datasets.push({label:'주담대 평균금리 (신규취급액)',mortgage:true,data,yAxisID:'mortgage',borderColor:'#a78bfa',backgroundColor:'transparent',borderDash:[6,3],pointRadius:0,borderWidth:2,tension:0,spanGaps:false,fill:false});
      chart.options.scales.mortgage={type:'linear',position:'right',beginAtZero:true,title:{display:true,text:'주담대 평균금리 (%)',color:'#a78bfa'},ticks:{color:'#a78bfa',callback:v=>v+'%',font:{size:10}},grid:{drawOnChartArea:false}};
      chart.options.plugins.legend.display=true;
      state.status.textContent=data.some(v=>v!==null)?`전국 예금은행 · 신규취급액 · 연 % · 최신 기준월 ${state.data.rows.at(-1).month}`:'선택 기간의 공시 자료가 없습니다.';
    }else state.status.textContent='';
    if(!chart.$mortgageTooltip){
      const callbacks=chart.options.plugins.tooltip.callbacks??={},label=callbacks.label,afterLabel=callbacks.afterLabel;
      callbacks.label=c=>c.dataset.mortgage?`${c.dataset.label}: ${c.parsed.y==null?'—':c.parsed.y.toFixed(2)+'%'}`:label?label(c):`${c.dataset.label}: ${c.formattedValue}`;
      callbacks.afterLabel=c=>{if(!c.dataset.mortgage)return afterLabel?.(c)||'';const row=state.data.rows.find(r=>r.month===month(chart.data.labels[c.dataIndex]));return row?`대상월 ${row.month} · 신규취급액 기준`:'';};
      chart.options.plugins.tooltip.callbacks=callbacks;chart.$mortgageTooltip=true;
    }
    chart.update('none');
  }
  window.NodoMarketMortgage={attach,series,month};
})();
