import {readFileSync,writeFileSync,renameSync,existsSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const source='https://portal.kfb.or.kr/fingoods/cofix.php';
const hash=b=>createHash('sha256').update(b).digest('hex');
const monthNumber=s=>Number(s.slice(0,4))*12+Number(s.slice(5,7))-1;
export function parseYear(html,year){
  const rows=[];
  for(const match of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
    const cells=[...match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>m[1].replace(/<[^>]*>/g,'').replace(/&nbsp;|&#160;/g,' ').trim());
    if(cells.length!==5||!/^\d{4}\/\d{2}\/\d{2}$/.test(cells[0])||!/^\d{4}\/\d{2}$/.test(cells[1]))continue;
    const publishedAt=cells[0].replaceAll('/','-'),month=cells[1].replace('/','-');
    if(Number(publishedAt.slice(0,4))!==year)throw Error('Unexpected publication year');
    const values=cells.slice(2).map(v=>{if(v===''||v==='-')return null;if(!/^\d{1,2}(\.\d{1,3})?$/.test(v))throw Error('Invalid COFIX value');return Number(v);});
    rows.push({month,publishedAt,new:values[0],balance:values[1],newBalance:values[2]});
  }
  if(!rows.length)throw Error('No monthly COFIX rows: '+year);
  if(new Set(rows.map(r=>r.month)).size!==rows.length)throw Error('Duplicate monthly COFIX rows');
  return rows;
}
export function validate(data,today){
  if(data.schema!==1||data.source!==source||!Array.isArray(data.rows)||!data.rows.length)throw Error('Invalid COFIX dataset');
  let previous;
  for(const row of data.rows){
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(row.month)||!/^\d{4}-\d{2}-\d{2}$/.test(row.publishedAt)||new Date(row.publishedAt+'T00:00:00Z').toISOString().slice(0,10)!==row.publishedAt)throw Error('Invalid COFIX date');
    if(row.publishedAt>today||monthNumber(row.publishedAt)!==monthNumber(row.month)+1)throw Error('COFIX publication/month mismatch');
    if(previous!==undefined&&monthNumber(row.month)!==previous+1)throw Error('Missing/duplicate COFIX month');
    previous=monthNumber(row.month);
    for(const key of ['new','balance','newBalance'])if(row[key]!==null&&(!Number.isFinite(row[key])||row[key]<0||row[key]>30))throw Error('Invalid COFIX rate');
    if(row.new===null||row.balance===null||(row.month>='2019-06'&&row.newBalance===null))throw Error('Required COFIX rate missing');
  }
  return data;
}
export async function collect({output,full=false,fetcher=fetch,today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date())}){
  const old=existsSync(output)?validate(JSON.parse(readFileSync(output,'utf8')),today):null;
  const year=Number(today.slice(0,4)),years=Array.from({length:year-(full||!old?2010:year-1)+1},(_,i)=>(full||!old?2010:year-1)+i),rows=new Map((old?.rows||[]).map(r=>[r.month,r])),pages={...(old?.pages||{})};
  for(const y of years){
    const url=source+'?BasicYear='+y,response=await fetcher(url,{signal:AbortSignal.timeout(25000)});
    if(!response.ok)throw Error('COFIX HTTP '+response.status);
    const bytes=new Uint8Array(await response.arrayBuffer()),parsed=parseYear(new TextDecoder('euc-kr').decode(bytes),y);
    const previous=(old?.rows||[]).filter(r=>Number(r.publishedAt.slice(0,4))===y);
    if(previous.some(r=>!parsed.some(p=>p.month===r.month)))throw Error('Previously published COFIX row missing');
    for(const row of parsed)rows.set(row.month,row);
    pages[y]={url,sha256:hash(bytes)};
  }
  const data=validate({schema:1,source,unit:'percent-per-year',basis:'target-month',updatedAt:today,pages,rows:[...rows.values()].sort((a,b)=>a.month.localeCompare(b.month))},today);
  if(old&&JSON.stringify(old.rows)===JSON.stringify(data.rows))return {status:'UNCHANGED',rows:data.rows.length,lastMonth:data.rows.at(-1).month};
  mkdirSync(dirname(output),{recursive:true});const temp=output+'.tmp';writeFileSync(temp,JSON.stringify(data)+'\n');renameSync(temp,output);
  return {status:'UPDATED',rows:data.rows.length,firstMonth:data.rows[0].month,lastMonth:data.rows.at(-1).month,bytes:readFileSync(output).length};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const output=resolve(process.argv.find(a=>a.startsWith('--output='))?.slice(9)||'data/market-rates/cofix.json');
  try{console.log(JSON.stringify(await collect({output,full:process.argv.includes('--full')})));}catch(e){console.error('COFIX collection failed; existing dataset preserved: '+e.message);process.exitCode=1;}
}
