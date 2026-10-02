import {readFileSync,writeFileSync,renameSync,existsSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const source='https://ecos.bok.or.kr';
export const statCode='121Y006',itemCode='BECBLA0302';
const monthNumber=s=>Number(s.slice(0,4))*12+Number(s.slice(5,7))-1;
const monthText=n=>`${Math.floor(n/12)}-${String(n%12+1).padStart(2,'0')}`;
const validMonth=s=>typeof s==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(s);
export function parsePage(data){
  const page=data.StatisticSearch;
  if(!page||!Number.isInteger(page.list_total_count)||page.list_total_count<1||!Array.isArray(page.row)||!page.row.length)throw Error('Invalid ECOS mortgage response');
  const rows=page.row.map(r=>{
    if(r.STAT_CODE!==statCode||r.ITEM_CODE1!==itemCode||r.ITEM_NAME1!=='주택담보대출'||r.UNIT_NAME!=='연리%'||!/^\d{4}(0[1-9]|1[0-2])$/.test(r.TIME)||typeof r.DATA_VALUE!=='string'||!/^\d{1,2}(\.\d+)?$/.test(r.DATA_VALUE)||[r.ITEM_CODE2,r.ITEM_CODE3,r.ITEM_CODE4].some(v=>v!=null&&v!==''))throw Error('Wrong or invalid ECOS mortgage series');
    return {month:r.TIME.slice(0,4)+'-'+r.TIME.slice(4),rate:Number(r.DATA_VALUE)};
  });
  return {total:page.list_total_count,rows};
}
export function validate(data,today){
  if(data.schema!==1||data.source!==source||data.statCode!==statCode||data.itemCode!==itemCode||data.unit!=='percent-per-year'||data.basis!=='new-loans-target-month'||!Array.isArray(data.rows)||!data.rows.length)throw Error('Invalid mortgage dataset');
  let previous;
  for(const row of data.rows){
    if(!validMonth(row.month)||row.month<'2001-09'||row.month>=today.slice(0,7)||typeof row.rate!=='number'||!Number.isFinite(row.rate)||row.rate<0||row.rate>30)throw Error('Invalid mortgage month/rate');
    const n=monthNumber(row.month);
    if(previous!==undefined&&n!==previous+1)throw Error('Missing/duplicate mortgage month');
    previous=n;
  }
  return data;
}
export async function collect({output,full=false,fetcher=fetch,today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date())}){
  const old=existsSync(output)?validate(JSON.parse(readFileSync(output,'utf8')),today):null;
  const first='2001-09',start=full||!old?first:monthText(Math.max(monthNumber(first),monthNumber(old.rows.at(-1).month)-23));
  const end=today.slice(0,7),fresh=[],pages=[];let total;
  for(let offset=1;total===undefined||offset<=total;offset+=10){
    const url=`${source}/api/StatisticSearch/sample/json/kr/${offset}/${offset+9}/${statCode}/M/${start.replace('-','')}/${end.replace('-','')}/${itemCode}`;
    const response=await fetcher(url,{signal:AbortSignal.timeout(25000)});
    if(!response.ok)throw Error('ECOS HTTP '+response.status);
    const bytes=new Uint8Array(await response.arrayBuffer()),page=parsePage(JSON.parse(new TextDecoder().decode(bytes)));
    if(total!==undefined&&total!==page.total)throw Error('ECOS pagination count changed');
    total=page.total;
    if(total>1000||page.rows.length!==Math.min(10,total-offset+1)||page.rows.some(r=>r.month<start||r.month>end))throw Error('Incomplete/out-of-range ECOS page');
    fresh.push(...page.rows);pages.push({url,sha256:createHash('sha256').update(bytes).digest('hex')});
  }
  validate({schema:1,source,statCode,itemCode,unit:'percent-per-year',basis:'new-loans-target-month',rows:fresh},today);
  if(fresh[0].month!==start||(old?.rows||[]).some(r=>r.month>=start&&!fresh.some(n=>n.month===r.month)))throw Error('Previously published mortgage month missing');
  const merged=new Map((old?.rows||[]).map(r=>[r.month,r]));for(const row of fresh)merged.set(row.month,row);
  const data=validate({schema:1,source,statCode,itemCode,unit:'percent-per-year',basis:'new-loans-target-month',checkedAt:today,pages,rows:[...merged.values()].sort((a,b)=>a.month.localeCompare(b.month))},today);
  if(old&&JSON.stringify(old.rows)===JSON.stringify(data.rows))return {status:'UNCHANGED',rows:data.rows.length,lastMonth:data.rows.at(-1).month};
  mkdirSync(dirname(output),{recursive:true});const temp=output+'.tmp';writeFileSync(temp,JSON.stringify(data)+'\n');renameSync(temp,output);
  return {status:'UPDATED',rows:data.rows.length,firstMonth:data.rows[0].month,lastMonth:data.rows.at(-1).month,lastRate:data.rows.at(-1).rate,bytes:readFileSync(output).length};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const output=resolve(process.argv.find(a=>a.startsWith('--output='))?.slice(9)||'data/market-rates/mortgage.json');
 try{console.log(JSON.stringify(await collect({output,full:process.argv.includes('--full')})));}catch(e){console.error('Mortgage collection failed; existing dataset preserved: '+e.message);process.exitCode=1;}
}
