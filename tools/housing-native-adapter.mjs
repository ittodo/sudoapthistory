// Private native calculations use local IDs; public packed keys include their LAWD.
export function scopedNativeMonth(lawd,month){
 if(!/^\d{5}$/.test(lawd))throw Error('Invalid native region');
 return Object.fromEntries(['rows','opening','updates'].map(field=>{
  if(!Array.isArray(month[field]))throw Error('Missing native row collection');
  return [field,month[field].map(row=>{if(!Array.isArray(row)||!Number.isSafeInteger(row[0])||row[0]<0||row[0]>0xffffffff)throw Error('Invalid native local identity');return [`${lawd}:${row[0]}`,...row.slice(1)];})];
 }));
}
