export function mapBoundaryReference(row){
 if(!row?.boundaryKey)return null;
 if(row.boundaryKey!==row.id||typeof row.g!=='string'||!row.g||/[\\/:\x00-\x1f]/.test(row.g)||['.','..'].includes(row.g)||!['parcel_union','review_display_correction'].includes(row.boundarySource))
  throw Error('Invalid map boundary reference');
 return {key:row.boundaryKey,region:row.g,source:row.boundarySource};
}

export function mapBoundarySources(map){
 const sources={};
 for(const[path,digest]of Object.entries(map?.meta?.sources||{})){
  if(!path.startsWith('data/map/boundaries/'))continue;
  if(!/^data\/map\/boundaries\/[^/\\:\x00-\x1f]+\.json$/.test(path)||!/^([a-f0-9]{64})$/.test(digest))throw Error('Invalid map boundary source');
  sources[path]=digest;
 }
 for(const row of map?.d||[]){
  const ref=mapBoundaryReference(row);if(ref&&!sources[`data/map/boundaries/${ref.region}.json`])throw Error('Missing map boundary source: '+ref.region);
 }
 return sources;
}
