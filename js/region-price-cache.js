/* Monthly regional frames: absolute daily replacements, never averages of averages. */
(function(root){
  const prefix='data/map/price-cache/';
  function eligible(s,type){
    const keys=type==='sale'?['g','q','searchIds','aL','aH','pL','pH','uL','uH','bL','bH']:['district','q','searchIds','areaMin','areaMax','depositMin','depositMax','rentMin','rentMax'];
    return keys.every(k=>s[k]==null||s[k]===''||(Array.isArray(s[k])&&!s[k].length))&&(!s.contract||s.contract==='all')&&(!s.kind||s.kind==='all');
  }
  function frame(file,day,converted=false){
    const rows=new Map(file.opening.regions),points=new Map(file.opening.points||[]);let meta=file.opening.meta;
    for(const update of file.updates){if(update.day>day)break;for(const [id,value]of update.regions){if(value)rows.set(id,value);else rows.delete(id);}for(const [id,p]of update.points||[]){if(p)points.set(id,p);else points.delete(id);}meta=update.meta;}
    const slot=converted?3:1;
    return {...meta,points:[...points.values()].map(p=>({...p,value:converted?p.convertedValue:p.value})),regionSummaries:[...rows].map(([id,r])=>[id,{count:r[0],pricedCount:r[slot],average:r[slot]?r[slot+1]/r[slot]:null,...(r.length>5?{depositAverage:r[5]?r[6]/r[5]:null,depositEquivalentAverage:r[7]?r[8]/r[7]:null}:{})}])};
  }
  function create(){
    const disk=root.NodoVerifiedDataCache.create('nodo-region-prices-v1',18),files=new Map();let manifestPromise,manifest,revision=0;
    async function index(){
      if(!manifestPromise)manifestPromise=fetch('/'+prefix+'index.json',{cache:'no-cache'}).then(async r=>{if(!r.ok)return null;const m=await r.json();if(m.schema!==1||!m.versions||!m.sources)return null;
        if(Object.entries(m.sources).some(([p,h])=>!/^data\/map\/price-cache\/\d{4}-\d{2}-(41|11|28)-(sale|jeonse|monthly)\.bin$/.test(p)||!/^[a-f0-9]{64}$/.test(h)))return null;
        return manifest=m;}).catch(()=>null);
      return manifestPromise;
    }
    function cancel(){revision++;for(const [path,e]of files)if(!e.done){e.controller.abort();files.delete(path);}}
    async function get(type,day,regions,versions,converted=false){
      const serial=++revision,m=await index();if(serial!==revision)return null;
      if(!m||Object.entries(versions).some(([k,v])=>m.versions[k]!==v))return null;
      const paths=regions.map(r=>prefix+day.slice(0,7)+'-'+r+'-'+type+'.bin');
      if(paths.some(p=>!m.sources[p]))return null;
      for(const [p,e]of files)if(!paths.includes(p)&&!e.done){e.controller.abort();files.delete(p);}
      try{
        const loaded=await Promise.all(paths.map(path=>{
          if(files.has(path))return files.get(path).promise;
          const entry={controller:new AbortController(),done:false};
          entry.promise=disk.download(path,m.sources[path],{signal:entry.controller.signal}).then(async bytes=>JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text())).then(value=>{entry.done=true;return value;}).catch(e=>{if(files.get(path)===entry)files.delete(path);throw e;});
          files.set(path,entry);return entry.promise;
        }));
        if(serial!==revision)return null;
        for(const path of [...files.keys()])if(files.size>9&&!paths.includes(path)&&files.get(path).done)files.delete(path);
        const result={regionSummaries:[],points:[],count:0,complexCount:0,stats:{count:0,cancelled:0,unlocated:0},regional:true};
        for(const file of loaded){const f=frame(file,day,converted);result.regionSummaries.push(...f.regionSummaries);result.points.push(...(f.points||[]));result.count+=f.count||0;result.complexCount+=f.complexCount||0;for(const k of Object.keys(result.stats))result.stats[k]+=f.stats?.[k]||0;}
        return result;
      }catch(e){if(e.name==='AbortError')return null;return null;}
    }
    return {get,cancel,index};
  }
  root.NodoRegionPrices={eligible,frame,create};
})(globalThis);
