(function(root) {
  'use strict';
  async function create({lazyCatalog=false}={}) {
    const response=await fetch('/data/daily/index.json',{cache:'no-cache'});
    if(!response.ok)throw Error('일별 데이터를 불러오지 못했습니다. 다시 시도해 주세요.');
    const index=await response.json();
    if(![1,2,3].includes(index.schema))throw Error('일별 데이터 형식이 변경되었습니다. 새로고침해 주세요.');
    const cache=new Map(),fileCache=globalThis.NodoVerifiedDataCache.createHousing();
    let activePricePaths=new Set(),prefetchPaths=new Set(),prefetchSerial=0;
    const protectedPath=path=>activePricePaths.has(path)||prefetchPaths.has(path);
    function trimCache(){
      for(const [path,entry]of cache){
        if(cache.size<=9)break;if(protectedPath(path))continue;
        if(entry.background&&!entry.settled)abortLoad(path,entry);else cache.delete(path);
      }
    }
    async function load(path,background=false) {
      if(!index.sources[path])throw Error('조회할 수 없는 데이터입니다. 새로고침해 주세요.');
      if(background&&!protectedPath(path))throw Object.assign(Error('Obsolete prefetch'),{name:'AbortError'});
      if(cache.has(path)){const entry=cache.get(path);if(!background)entry.background=false;cache.delete(path);cache.set(path,entry);return entry.promise;}
      const entry={controller:new AbortController(),background,settled:false};
      const promise=fileCache.download(path,index.sources[path],{signal:entry.controller.signal,background,persist:stateFile(path)||/^data\/daily\/regions\/\d{5}\/quarters\//.test(path),range:index.regional?.stateSections?.[path]}).then(async bytes=>{
        entry.controller.signal.throwIfAborted();
        const value=await globalThis.NodoVerifiedDataCache.decode(bytes,path);entry.controller.signal.throwIfAborted();return value;
      }).catch(e=>{if(cache.get(path)===entry)cache.delete(path);throw e;}).finally(()=>{entry.settled=true;});
      entry.promise=promise;cache.set(path,entry);
      trimCache();
      return promise;
    }
    load.promote=p=>{if(cache.has(p))cache.get(p).background=false;};
    function abortLoad(path,entry){entry.controller.abort();if(cache.get(path)===entry)cache.delete(path);regional?.discardPending?.([path]);}
    const stateFile=p=>p.includes('-state.')||/^data\/daily\/regions\/\d{5}\/(base|months|states)\//.test(p);
    const extension=index.encoding==='gzip-json'?'bin':'json';
    let regional=null,catalog=null,catalogPromise;
    async function ensureCatalog(){
      if(catalog)return catalog;
      if(!catalogPromise)catalogPromise=(async()=>{regional=index.schema>=2?await globalThis.NodoRegional.create(index,'daily',load):null;return catalog=regional||await load('data/daily/catalog.'+extension);})().catch(e=>{catalogPromise=null;throw e;});
      return catalogPromise;
    }
    if(!lazyCatalog)await ensureCatalog();
    const partitionMembers=new Map();
    for(const path of Object.keys(index.sources)){const descriptor=path.replace(/-(?:p[01]{1,32}|order)\.bin$/,'.parts.json');if(descriptor!==path){if(!partitionMembers.has(descriptor))partitionMembers.set(descriptor,[]);partitionMembers.get(descriptor).push(path);}}
    function monthPaths(ym,selected,state=true){
      if(!index.months.includes(ym))return [];
      return selected.flatMap(r=>regional?regional.paths(ym,r):[`data/daily/${r}/${ym}${state?'-state':''}.${extension}`]).flatMap(path=>[path,...(partitionMembers.get(path)||[])]);
    }
    const nextMonth=ym=>NodoDailyModel.shift(ym+'-01',1,'month').slice(0,7);
    function retainPaths(active,warm){
      const previous=new Set([...activePricePaths,...prefetchPaths]);
      activePricePaths=active;prefetchPaths=warm;
      for(const [path,entry]of cache){if(active.has(path))entry.background=false;else if(!warm.has(path)&&!entry.settled&&(entry.background||stateFile(path)||previous.has(path)))abortLoad(path,entry);}
      trimCache();
    }
    const month=async(ym,r,state=false,background=false)=>{if(!index.months.includes(ym))return state?{opening:[],updates:[]}:{rows:[]};await ensureCatalog();return regional?regional.shard(`data/daily/${r}/${ym}${state?'-state':''}.${extension}`,ym,r,background):load(`data/daily/${r}/${ym}${state?'-state':''}.${extension}`,background);};
    const regions=f=>f.r==null?[0,1,2]:[f.r];
    async function trades(ym,f={}) {const groups=await Promise.all(regions(f).map(r=>month(ym,r)));return groups.flatMap(g=>g.rows.map(row=>NodoDailyModel.decode(row,catalog)));}
    async function prices(date,f={}) {const groups=await Promise.all(regions(f).map(r=>month(date.slice(0,7),r,true)));return groups.flatMap(g=>[...NodoDailyModel.snapshot(g,NodoDailyModel.number(date)).values()]);}
    const cursors=new Map();let frameSerial=0;
    function cancelPrices(){frameSerial++;prefetchSerial++;retainPaths(new Set(),new Set());}
    async function priceFrame(date,f={},fromDate=null){
      const serial=++frameSerial,selected=regions(f),ym=date.slice(0,7),day=NodoDailyModel.number(date);
      prefetchSerial++;
      await ensureCatalog();if(serial!==frameSerial)return {values:[],events:[],changes:[],reset:true};
      const visible=new Set(monthPaths(ym,selected)),wanted=new Set(visible),warm=new Set(monthPaths(nextMonth(ym),selected));
      if(fromDate)for(let m=fromDate.slice(0,7);m<ym;m=nextMonth(m))for(const p of monthPaths(m,selected))wanted.add(p);
      retainPaths(wanted,warm);
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
      finally{if(serial===frameSerial)retainPaths(visible,prefetchPaths);}
    }
    async function prefetch(date,f={},state=false){
      const serial=++prefetchSerial,frame=frameSerial,next=nextMonth(date.slice(0,7)),selected=regions(f);
      try{await ensureCatalog();}catch{return;}if(serial!==prefetchSerial||frame!==frameSerial)return;
      retainPaths(activePricePaths,new Set(monthPaths(next,selected,state)));
      if(index.months.includes(next))await Promise.allSettled(selected.map(r=>month(next,r,state,true)));
    }
    return {index,get catalog(){return catalog;},load,month,trades,prices,priceFrame,prefetch,cancelPrices};
  }
  root.NodoDailyClient={create};
})(window);
