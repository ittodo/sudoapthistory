export function validateManifest(m,table){
 if(m.schema!==3||m.regional?.format!=='packed-region'||!['daily','rental'].includes(m.regional.kind)||!Array.isArray(m.months)||!m.sources)throw Error('Invalid packed manifest');
 const rg=m.regional;if(rg.authority!=='data/daily/regions/index.json'||Object.keys(rg).some(k=>!['format','kind','authority','quarters','states'].includes(k)))throw Error('Unexpected packed dependencies');
 if(m.months.some((x,i)=>!/^\d{4}-(0[1-9]|1[0-2])$/.test(x)||i&&x<=m.months[i-1]))throw Error('Invalid dataset months');
 const files=new Set([rg.authority]);for(const[code,r]of table.regions){for(const field of ['identities','metadata']){const expected=`data/daily/regions/${code}/${field}.json`;if(r.entry[field]!==expected)throw Error('Identity path mismatch');files.add(expected);}}
 for(const section of ['quarters','states'])for(const[code,entries]of Object.entries(rg[section]||{})){
  if(!table.regions.has(code)||!entries||Array.isArray(entries))throw Error('Unknown region scope');
  for(const[month,path]of Object.entries(entries)){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('Invalid region month');if(section==='states'&&path===null){if(!rg.quarters?.[code]?.[month])throw Error('Empty state without quarter');continue;}const q=month.slice(0,4)+'-Q'+Math.ceil(Number(month.slice(5))/3),expected=`data/daily/regions/${code}/`+(section==='quarters'?`quarters/${q}.bin`:`states/${rg.kind}/${month.slice(0,4)}.bin`);if(path!==expected&&path!==expected.slice(0,-4)+'.parts.json')throw Error('Packed path scope mismatch');files.add(path);if(!Object.hasOwn(rg[section==='quarters'?'states':'quarters']?.[code]||{},month))throw Error('Incomplete state/quarter coverage');}
 }
 for(const p of Object.keys(m.sources))if(/-(?:p[01]{1,32}|order)\.bin$/.test(p)){const base=p.replace(/-(?:p[01]{1,32}|order)\.bin$/,'.parts.json');if(!files.has(base))throw Error('Orphan partition source');files.add(p);}
 for(const p of files)if(!/^[a-f0-9]{64}$/.test(m.sources[p]||''))throw Error('Missing source hash');
 for(const p of Object.keys(m.sources)){if(!files.has(p)&&!['data/map/index.json','data/rental/rates.json','data/rental/summary.json'].includes(p))throw Error('Orphan packed source: '+p);}
}
export function validateRows(shard,code,kind,identity){
 const areaSet=new Set(identity.areas.map(([c,a])=>c+'|'+a));
 for(const field of ['rows','opening','updates'])for(const row of shard[field]||[]){const key=String(row[0]),n=Number(key.slice(6));if(!key.startsWith(code+':')||String(n)!==key.slice(6)||!Number.isSafeInteger(n)||n<0||row.length!==(kind==='rental'?18:field==='rows'?12:6))throw Error('Invalid packed row reference');if(kind==='daily'?!identity.areas[n]:!identity.complexes[n]||!areaSet.has(n+'|'+row[1]))throw Error('Unregistered packed identity/area');}
 return shard;
}
