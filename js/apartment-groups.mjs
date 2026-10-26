// Filters use the original source IDs. Shared transaction files are unchanged.
export function selectApartmentMember(apartment,key=''){
 const member=apartment.displayGroup?.members?.find(m=>m.key===key);
 if(!member)return apartment;
 const areas=apartment.areas.filter(a=>a.rows?.some(r=>r.source===key)).map(a=>{
  const summary=a.memberSummaries?.[key];
  if(!summary)throw Error('선택한 단지의 가격 요약이 없습니다.');
  return {...a,...summary,units:null,rows:a.rows.filter(r=>r.source===key)};
 });
 return {...apartment,sources:[key],areas,selectedMember:member};
}
