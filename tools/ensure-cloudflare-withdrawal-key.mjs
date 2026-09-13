import {randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';

// Staging only. Never read existing values, rotate a key, or persist plaintext.
export async function ensureKey(env=process.env,request=fetch){
 const account='90ef0cc5b9fc89e9005b5ca905ae2b6e';
 if(env.GITHUB_ACTIONS!=='true'||env.GITHUB_REF!=='refs/heads/cloudflare-staging'||env.CLOUDFLARE_ACCOUNT_ID!==account||!env.CLOUDFLARE_API_TOKEN)throw new Error('Staging secret setup target rejected');
 const url=`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/nodostream-staging/secrets`;
 const headers={Authorization:`Bearer ${env.CLOUDFLARE_API_TOKEN}`,'Content-Type':'application/json'};
 const call=async(method,payload)=>{
  const response=await request(url,{method,headers,redirect:'error',signal:AbortSignal.timeout(30000),...(payload?{body:JSON.stringify(payload)}:{})});
  // Never include the response/error body: secret API errors could echo input.
  if(!response.ok)throw new Error('Staging secret request failed');
  const data=await response.json();if(data.success!==true)throw new Error('Staging secret request rejected');return data.result;
 };
 const existing=await call('GET');if(!Array.isArray(existing))throw new Error('Unexpected secret inventory');
 const key=existing.find(x=>x.name==='WITHDRAWAL_ENCRYPTION_KEY');
 if(key){if(key.type!=='secret_text')throw new Error('Unexpected key binding type');return 'existing';}
 await call('PUT',{name:'WITHDRAWAL_ENCRYPTION_KEY',type:'secret_text',text:randomBytes(32).toString('hex')});
 return 'created';
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{console.log(`Staging withdrawal key: ${await ensureKey()}`);}catch{console.error('Staging withdrawal key setup failed; no key values logged.');process.exitCode=1;}
}
