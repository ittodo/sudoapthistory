import {displayArea} from './housing-sale-detail.mjs';

// Read shared facts that are absent from the legacy screener.
// Browser lookup and group completion share this helper. Detail encoding does not.
export function directSaleRows(facts,table,source,area){
 const key=table.source.get(source),rows=[];
 if(!key)return rows;
 for(const f of facts){const pair=table.areas[f[0]];if(pair?.[0]!==key||displayArea(Number(pair[1]))!==area)continue;
  rows.push({date:f[1],price:f[2],floor:f[3],flags:f[4],cancelled:'',order:rows.length,identity:f[10],exactArea:pair[1],source});
 }
 return rows;
}
