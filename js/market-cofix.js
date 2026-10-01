/* Nationwide published COFIX; independent of housing calculations. */
(()=>{
  'use strict';
  const names={new:'신규취급액',balance:'잔액',newBalance:'신잔액'};
  function month(label){const m=/^(\d{4})[-.](\d{2})$/.exec(label);return m?m[1]+'-'+m[2]:null;}
  function series(rows,labels,key){const map=new Map(rows.map(r=>[r.month,r]));return labels.map(label=>map.get(month(label))?.[key]??null);}
  let promise;const mounts=new WeakMap();
  function load(){return promise??=fetch('/data/market-rates/cofix.json').then(r=>{if(!r.ok)throw Error('COFIX HTTP '+r.status);return r.json();}).then(d=>{if(d.schema!==1||d.basis!=='target-month'||!Array.isArray(d.rows)||d.rows.some(r=>!month(r.month)||!/^\d{4}-\d{2}-\d{2}$/.test(r.publishedAt)||['new','balance','newBalance'].some(k=>r[k]!==null&&!Number.isFinite(r[k]))))throw Error('Invalid COFIX data');return d;});}
  function attach(chart){
    const canvas=chart.canvas;if(!['priceChart','mr-price'].includes(canvas.id))return;
    let state=mounts.get(canvas);
    if(!state){
      const panel=document.createElement('div');panel.className='market-cofix';
      panel.innerHTML='<label><input type="checkbox"> COFIX 표시</label> <label>기준 <select aria-label="COFIX 기준"><option value="new">신규취급액</option><option value="balance">잔액</option><option value="newBalance">신잔액</option></select></label><span role="status"></span><a href="https://portal.kfb.or.kr/fingoods/cofix.php" target="_blank" rel="noopener">은행연합회 공시</a>';
      panel.style.cssText='display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:12px 0;font-size:12px;color:var(--muted)';
      canvas.parentElement.parentElement.insertBefore(panel,canvas.parentElement);
      state={panel,check:panel.querySelector('input'),select:panel.querySelector('select'),status:panel.querySelector('[role=status]')};state.check.checked=true;mounts.set(canvas,state);
      state.check.onchange=state.select.onchange=()=>apply(state);
    }
    state.chart=chart;
    load().then(data=>{state.data=data;apply(state);}).catch(()=>{state.status.textContent='금리 자료를 불러오지 못했습니다. 가격 자료는 그대로 표시합니다.';});
  }
  function apply(state){
    const chart=state.chart;if(!chart?.ctx||!state.data)return;
    chart.data.datasets=chart.data.datasets.filter(d=>!d.cofix);
    delete chart.options.scales.cofix;
    if(state.check.checked){
      const key=state.select.value,data=series(state.data.rows,chart.data.labels,key);
      chart.data.datasets.push({label:'COFIX '+names[key],cofix:true,data,yAxisID:'cofix',borderColor:'#a78bfa',backgroundColor:'transparent',borderDash:[6,3],pointRadius:0,borderWidth:2,tension:0,spanGaps:false,fill:false});
      chart.options.scales.cofix={type:'linear',position:'right',beginAtZero:true,title:{display:true,text:'COFIX (%)',color:'#a78bfa'},ticks:{color:'#a78bfa',callback:v=>v+'%',font:{size:10}},grid:{drawOnChartArea:false}};
      chart.options.plugins.legend.display=true;
      state.status.textContent=data.some(v=>v!==null)?'대상월 기준 · 연 % · 실제 대출금리와 다릅니다.':'선택 기간의 공시 자료가 없습니다.';
    }else state.status.textContent='';
    if(!chart.$cofixTooltip){
      const callbacks=chart.options.plugins.tooltip.callbacks??={},label=callbacks.label,afterLabel=callbacks.afterLabel;
      callbacks.label=c=>c.dataset.cofix?`${c.dataset.label}: ${c.parsed.y==null?'—':c.parsed.y.toFixed(2)+'%'}`:label?label(c):`${c.dataset.label}: ${c.formattedValue}`;
      callbacks.afterLabel=c=>{if(!c.dataset.cofix)return afterLabel?.(c)||'';const row=state.data.rows.find(r=>r.month===month(chart.data.labels[c.dataIndex]));return row?`대상월 ${row.month} · 공시일 ${row.publishedAt}`:'';};
      chart.options.plugins.tooltip.callbacks=callbacks;chart.$cofixTooltip=true;
    }
    chart.update('none');
  }
  window.NodoMarketCofix={attach,series,month};
})();
