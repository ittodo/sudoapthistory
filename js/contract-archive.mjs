import * as codec from './generated/housing-columns.mjs';
import {restoreContract} from './housing-contract-detail.mjs';
export function contractArchive(bytes){
 const table=codec.openColumns(codec.schemas.ContractDetail,bytes);
 return {get(identity,occurrence){let lo=0,hi=table.rowCount;while(lo<hi){const mid=(lo+hi)>>>1,row=table.row(mid),cmp=row[0].localeCompare(identity)||row[1]-occurrence;if(cmp<0)lo=mid+1;else hi=mid;}if(lo===table.rowCount)return null;const r=table.row(lo);return r[0]===identity&&r[1]===occurrence?r:null;}};
}
export function rentalDetail(fact,source,occurrence,archive){
 const detail=archive?.get(fact[17],occurrence)??[fact[17],occurrence,'',['구분 미상','신규','갱신'][fact[5]],'',null,null,0,''];
 return {...restoreContract(fact,source,detail,{}),recordIdentity:fact[17],recordOccurrence:occurrence};
}
