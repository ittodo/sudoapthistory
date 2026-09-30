// Complete regional state index: each distinct state once, plus its validity intervals.
// No previous-file chain. Reconstructs existing monthly opening arrays exactly.
const monthId = month => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw Error('Invalid state month');
  return Number(month.slice(0,4))*12+Number(month.slice(5))-1;
};
const monthName = id => `${Math.floor(id/12).toString().padStart(4,'0')}-${(id%12+1).toString().padStart(2,'0')}`;
const local = (key, lawd) => {
  const match=String(key).match(/^(\d{5}):(0|[1-9]\d*)$/);
  if (!match || match[1]!==lawd || Number(match[2])>0xffffffff) throw Error('State region mismatch');
  return Number(match[2]);
};
export function packStateTimeline(lawd, kind, openings, codec) {
  if (!/^\d{5}$/.test(lawd)||!['daily','rental'].includes(kind)) throw Error('Invalid state scope');
  const months=Object.keys(openings).sort(), states=[], stateIds=new Map(), intervals=[];
  let previous=new Map(),lastMonth=-2;
  for (const month of months) {
    const id=monthId(month), current=new Map();
    if (!Array.isArray(openings[month])) throw Error('State rows required');
    openings[month].forEach((row,position)=>{
      if (!Array.isArray(row)||row.length!==(kind==='daily'?6:18)) throw Error('State width mismatch');
      if(row.some(v=>v!==null&&typeof v!=='string'&&typeof v!=='number'||typeof v==='number'&&!Number.isFinite(v)))throw Error('Invalid state cell');
      const packed=row.slice();packed[0]=local(row[0],lawd);
      if(kind==='rental') packed[15]=row[15]===null?null:monthId(row[15]);
      const canonical=JSON.stringify(packed.map(v=>Object.is(v,-0)?{negativeZero:true}:v));let stateId=stateIds.get(canonical);
      if(stateId===undefined){stateId=states.length;stateIds.set(canonical,stateId);states.push(packed);}
      const old=previous.get(position);
      if(id===lastMonth+1&&old!==undefined&&intervals[old][3]===stateId){intervals[old][1]=id;current.set(position,old);}
      else {current.set(position,intervals.length);intervals.push([id,id,position,stateId]);}
    });
    previous=current;lastMonth=id;
  }
  return {lawd,kind,months,counts:months.map(m=>openings[m].length),
    states:codec.encodeColumns(codec.schemas[kind==='daily'?'SaleMapState':'RentalMapState'],states),
    intervals:codec.encodeColumns(codec.schemas.StateInterval,intervals),
    stats:{originalRows:months.reduce((n,m)=>n+openings[m].length,0),uniqueStates:states.length,intervals:intervals.length}};
}
export function openStateTimeline(packed,codec) {
  const {lawd,kind,months,counts}=packed;
  if(!/^\d{5}$/.test(lawd)||!['daily','rental'].includes(kind)||!Array.isArray(months)||!Array.isArray(counts)||months.length!==counts.length)throw Error('Invalid state index');
  const monthSet=new Set(months.map(monthId));
  if(months.length>12||new Set(months.map(m=>m.slice(0,4))).size>1||monthSet.size!==months.length||months.some((m,i)=>i&&m<=months[i-1])||counts.some(n=>!Number.isSafeInteger(n)||n<0))throw Error('Invalid state coverage');
  const states=codec.openColumns(codec.schemas[kind==='daily'?'SaleMapState':'RentalMapState'],packed.states);
  const intervals=codec.openColumns(codec.schemas.StateInterval,packed.intervals);
  if(counts.some(n=>n>intervals.rowCount))throw Error('Impossible state count');
  const byMonth=new Map(months.map((m,i)=>[monthId(m),new Array(counts[i])]));
  for(let i=0;i<intervals.rowCount;i++){
    const [first,last,position,stateId]=intervals.row(i);
    if(first>last||last-first>=months.length||stateId>=states.rowCount)throw Error('Invalid state interval');
    for(let m=first;m<=last;m++){
      const rows=byMonth.get(m);if(!rows||position>=rows.length||rows[position]!==undefined)throw Error('Overlapping/unknown state interval');rows[position]=stateId;
    }
  }
  for(const rows of byMonth.values())for(let i=0;i<rows.length;i++)if(rows[i]===undefined)throw Error('Incomplete state coverage');
  return {month(month){const refs=byMonth.get(monthId(month));if(!refs)throw Error('State month not covered');return refs.map(id=>{const row=states.row(id);row[0]=lawd+':'+row[0];if(kind==='rental'&&row[15]!==null)row[15]=monthName(row[15]);return row;});},stats:packed.stats};
}

// The on-wire index is self-contained. Compression is performed by the packager.
export function encodeStateFile(packed) {
  const header=new TextEncoder().encode(JSON.stringify({schema:1,lawd:packed.lawd,kind:packed.kind,months:packed.months,counts:packed.counts,stateBytes:packed.states.length,intervalBytes:packed.intervals.length}));
  if(header.length>1048576)throw Error('State header too large');
  const bytes=new Uint8Array(12+header.length+packed.states.length+packed.intervals.length);
  bytes.set(new TextEncoder().encode('PGSTATE1'));new DataView(bytes.buffer).setUint32(8,header.length,true);
  bytes.set(header,12);bytes.set(packed.states,12+header.length);bytes.set(packed.intervals,12+header.length+packed.states.length);return bytes;
}
export function decodeStateFile(bytes,codec,expected) {
  if(!(bytes instanceof Uint8Array)||bytes.length<12||new TextDecoder().decode(bytes.subarray(0,8))!=='PGSTATE1')throw Error('Wrong state file');
  const length=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(8,true);
  if(length>1048576||length>bytes.length-12)throw Error('Invalid state header');
  const header=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(12,12+length))),start=12+length;
  if(header.schema!==1||!Number.isSafeInteger(header.stateBytes)||header.stateBytes<0||!Number.isSafeInteger(header.intervalBytes)||header.intervalBytes<0||start+header.stateBytes+header.intervalBytes!==bytes.length)throw Error('Invalid state file bounds');
  if(!expected||header.lawd!==expected.lawd||header.kind!==expected.kind)throw Error('Unexpected state scope');
  return openStateTimeline({...header,states:bytes.subarray(start,start+header.stateBytes),intervals:bytes.subarray(start+header.stateBytes)},codec);
}
