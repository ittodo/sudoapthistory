/* One roster for all tenures. Original sale metrics and row IDs remain intact. */
(function(root){
  function newer(a,b){return !a?b:!b?a:a.date>b.date||a.date===b.date&&String(a.transactionId)>=String(b.transactionId)?a:b;}
  function join(sale,apartments,prices){
    const byRow=new Map();for(const e of apartments)for(const i of e.rows)byRow.set(i,e);
    const records=new Map();for(const p of prices){const key=JSON.stringify([p.id,p.area]);if(!records.has(key))records.set(key,{});records.get(key)[p.type]=newer(records.get(key)[p.type],p);}
    const seen=new Set(),samples=new Map(),keysById=new Map(),out=sale.map(x=>{const e=byRow.get(x.i),id=e?.id||x.as,key=JSON.stringify([id,Math.round(x.a)]);seen.add(key);samples.set(id,x);return {...x,_homeId:id,_rents:records.get(key)||{},_detailId:id};});
    for(const key of records.keys()){const id=JSON.parse(key)[0];if(!keysById.has(id))keysById.set(id,[]);keysById.get(id).push(key);}
    for(const e of apartments){const keys=keysById.get(e.id)||[];if(!keys.length&&!e.rows.length)keys.push(JSON.stringify([e.id,null]));
      for(const key of keys){if(seen.has(key))continue;seen.add(key);const area=JSON.parse(key)[1],sample=samples.get(e.id);
        out.push({i:'search:'+key,as:e.rentalIds[0]||e.saleIds[0]||e.id,n:e.name,r:e.r,g:e.g,d:e.d,a:area,b:sample?.b??e.built??null,tu:sample?.tu??e.units??null,u:null,j:e.addresses[0]||'',rd:'',lp:null,ld:null,c:null,m:null,s:null,v:null,t:null,_synthetic:true,_homeId:e.id,_detailId:e.id,_rents:records.get(key)||{}});
      }
    }
    const groups=new Map();for(const row of out){if(!groups.has(row._homeId))groups.set(row._homeId,[]);groups.get(row._homeId).push(row.i);}
    for(const row of out)row.si=groups.get(row._homeId);
    return out;
  }
  function record(row,type,rows){if(!row._merged)return row._rents?.[type]||null;return row.si.reduce((value,id)=>newer(value,rows[id]?._rents?.[type]),null);}
  function fallback(entity){return {id:entity.rentalIds[0]||entity.id,name:entity.name,address:entity.addresses[0]||'',road:'',region:['경기','서울','인천'][entity.r],units:entity.units??null,years:entity.built?[entity.built]:[],parking:null,far:null,coord:entity.coord||null,pnus:[],status:'unknown',rental:entity.rental===true,conflict:true,updated:'',areas:[],registry:[],sources:entity.rentalIds};}
  function sortKey(type,key){return type==='sale'||['n','g','d','a','lp','ld','u','ls'].includes(key)?key:'ld';}
  root.NodoHomeSearchModel={join,record,newer,fallback,sortKey};
})(globalThis);
