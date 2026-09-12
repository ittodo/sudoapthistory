import {fileURLToPath} from 'node:url';
export function budgetLevel(estimate) {
  if(estimate===undefined || estimate==='')return 'unavailable';
  const value=Number(estimate);if(!Number.isFinite(value)||value<0)throw new Error('Invalid monthly cost estimate');
  return value>=9?'critical':value>=7?'warning':'normal';
}
export async function check(origin,estimate) {
  const url=new URL(origin);if(url.protocol!=='https:'||url.pathname!=='/'||url.search||url.hash)throw new Error('HTTPS origin required');
  const r=await fetch(`${url.origin}/api/health`,{redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!r.ok)throw new Error(`Health HTTP ${r.status}`);
  const health=await r.json();if(health.status!=='ok'||health.maintenance)throw new Error('Service unhealthy or in maintenance');
  const budget=budgetLevel(estimate);
  if(budget==='critical'||budget==='warning')throw new Error(`Operator-supplied monthly estimate: ${budget}; this is not a hard spending cap`);
  console.log(JSON.stringify({status:'ok',budget,automaticCostMeasurement:false}));
}
if(process.argv[1]===fileURLToPath(import.meta.url))try{await check(process.env.ORIGIN,process.env.MONTHLY_ESTIMATE_USD);}catch(e){console.error(e.message);process.exitCode=1;}
