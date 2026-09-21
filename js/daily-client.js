(function(root) {
  'use strict';
  async function create() {
    const response=await fetch('/data/daily/index.json',{cache:'no-cache'});
    if(!response.ok)throw Error('일별 데이터를 불러오지 못했습니다. 다시 시도해 주세요.');
    const index=await response.json();
    if(index.schema!==1)throw Error('일별 데이터 형식이 변경되었습니다. 새로고침해 주세요.');
    const cache=new Map(),fileCache=globalThis.NodoVerifiedDataCache.create('nodo-sale-map-v1');
    let activePricePaths=new Set();
    async function load(path,background=false) {
      if(!index.sources[path])throw Error('조회할 수 없는 데이터입니다. 새로고침해 주세요.');
      if(cache.has(path)){const entry=cache.get(path);if(!background)entry.background=false;cache.delete(path);cache.set(path,entry);return entry.promise;}
      const entry={controller:new AbortController(),background,settled:false};
      const promise=fileCache.download(path,index.sources[path],{signal:entry.controller.signal,background,persist:path.includes('-state.')}).then(async bytes=>{
        entry.controller.signal.throwIfAborted();
        if(path.endsWith('.bin')){
          if(typeof DecompressionStream==='undefined')throw Error('압축 데이터를 지원하는 최신 브라우저가 필요합니다.');
          const text=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
          entry.controller.signal.throwIfAborted();return JSON.parse(text);
        }
        return JSON.parse(new TextDecoder().decode(bytes));
      }).catch(e=>{if(cache.get(path)===entry)cache.delete(path);throw e;}).finally(()=>{entry.settled=true;});
      entry.promise=promise;cache.set(path,entry);
      if(cache.size>9){const oldest=[...cache.keys()].find(p=>!activePricePaths.has(p));if(oldest){const old=cache.get(oldest);if(old.background&&!old.settled)old.controller.abort();cache.delete(oldest);}}
      return promise;
    }
    const extension=index.encoding==='gzip-json'?'bin':'json';
    const catalog=await load('data/daily/catalog.'+extension);
    const statePath=(ym,r)=>`data/daily/${r}/${ym}-state.${extension}`;
    const month=(ym,r,state=false,background=false)=>index.months.includes(ym)?load(`data/daily/${r}/${ym}${state?'-state':''}.${extension}`,background):Promise.resolve(state?{opening:[],updates:[]}:{rows:[]});
    const regions=f=>f.r==null?[0,1,2]:[f.r];
    async function trades(ym,f={}) {const groups=await Promise.all(regions(f).map(r=>month(ym,r)));return groups.flatMap(g=>g.rows.map(row=>NodoDailyModel.decode(row,catalog)));}
    async function prices(date,f={}) {const groups=await Promise.all(regions(f).map(r=>month(date.slice(0,7),r,true)));return groups.flatMap(g=>[...NodoDailyModel.snapshot(g,NodoDailyModel.number(date)).values()]);}
    const cursors=new Map();let frameSerial=0;
    function cancelPrices(){frameSerial++;activePricePaths=new Set();for(const [path,entry]of cache)if(path.includes('-state.')&&!entry.settled){entry.controller.abort();cache.delete(path);}}
    async function priceFrame(date,f={},fromDate=null){
      const serial=++frameSerial,selected=regions(f),ym=date.slice(0,7),day=NodoDailyModel.number(date);
      const wanted=new Set(selected.map(r=>statePath(ym,r)));
      if(fromDate)for(let m=fromDate.slice(0,7);m<ym;m=NodoDailyModel.shift(m+'-01',1,'month').slice(0,7))for(const r of selected)wanted.add(statePath(m,r));
      activePricePaths=wanted;
      for(const [path,entry]of cache){if(wanted.has(path))entry.background=false;else if(path.includes('-state.')&&!entry.settled){entry.controller.abort();cache.delete(path);}}
      try{
      const shards=await Promise.all(selected.map(async r=>({r,data:await month(ym,r,true)})));
      const values=[],events=[],changes=[];let reset=false;
      if(fromDate&&fromDate.slice(0,7)<ym){
        let cursorMonth=fromDate.slice(0,7);
        while(cursorMonth<ym){
          if(serial!==frameSerial)return {values:[],events:[],changes:[],reset:true};
          for(const r of selected){const data=await month(cursorMonth,r,true);const cursor=NodoDailyModel.priceCursor(data);const result=cursor.seek(99999999);
            for(const e of result.events)if(e.state[1]>NodoDailyModel.number(fromDate))events.push(e);
          }
          cursorMonth=NodoDailyModel.shift(cursorMonth+'-01',1,'month').slice(0,7);
        }
      }
      if(serial!==frameSerial)return {values:[],events:[],changes:[],reset:true};
      for(const {r,data}of shards){
        let cursor=cursors.get(r);
        if(!cursor||cursor.ym!==ym||cursor.data!==data){cursor={ym,data,value:NodoDailyModel.priceCursor(data)};cursors.set(r,cursor);reset=true;}
        const result=cursor.value.seek(day);reset ||= result.reset;values.push(result.values);
        changes.push(...result.events);
        for(const event of fromDate?result.events:result.atDate)if(!fromDate||event.state[1]>NodoDailyModel.number(fromDate))events.push(event);
      }
      for(const r of cursors.keys())if(!selected.includes(r))cursors.delete(r);
      return {values,events,changes,reset};
      }catch(error){if(serial!==frameSerial)return {values:[],events:[],changes:[],reset:true};throw error;}
    }
    function prefetch(date,f={},state=false){const next=NodoDailyModel.shift(date,1,'month').slice(0,7);if(index.months.includes(next))for(const r of regions(f))month(next,r,state,true).catch(()=>{});}
    return {index,catalog,load,month,trades,prices,priceFrame,prefetch,cancelPrices};
  }
  root.NodoDailyClient={create};
})(window);
