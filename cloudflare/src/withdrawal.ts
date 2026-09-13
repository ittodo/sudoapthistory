import {Env,HttpError,json,now,hash,token,cookie,setCookie,session,rate} from './shared';
import {RECOVERY_SECONDS} from './account-lifecycle';

const NAME='__Host-nodo_withdrawal';
const unavailable=()=>new HttpError(503,'WITHDRAWAL_UNAVAILABLE','Google 연결 해제를 준비 중입니다. 잠시 후 다시 시도해 주세요.');
export function withdrawalEnabled(env:Env){return env.WITHDRAWAL_ENABLED==='true'&&!!env.WITHDRAWAL_ENCRYPTION_KEY;}
async function key(env:Env){
 const raw=env.WITHDRAWAL_ENCRYPTION_KEY||'';
 if(!/^[a-f0-9]{64}$/i.test(raw))throw unavailable();
 return crypto.subtle.importKey('raw',Uint8Array.from(raw.match(/../g)!,s=>parseInt(s,16)),{name:'AES-GCM'},false,['encrypt','decrypt']);
}
export async function identityHash(env:Env,sub:string){
 // Domain-separated HMAC; no raw Google identity retained after account deletion.
 await key(env);
 const raw=Uint8Array.from(env.WITHDRAWAL_ENCRYPTION_KEY!.match(/../g)!,s=>parseInt(s,16));
 const signingKey=await crypto.subtle.importKey('raw',raw,{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',signingKey,new TextEncoder().encode('withdrawal-identity:'+env.SITE_ORIGIN+':'+sub)))).map(b=>b.toString(16).padStart(2,'0')).join('');
}
export async function sealToken(env:Env,id:string,value:string){
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(env.SITE_ORIGIN+':'+id)},await key(env),new TextEncoder().encode(value));
 return JSON.stringify([Array.from(iv),Array.from(new Uint8Array(encrypted))]);
}
async function openToken(env:Env,id:string,value:string){
 const [iv,bytes]=JSON.parse(value);
 return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(iv),additionalData:new TextEncoder().encode(env.SITE_ORIGIN+':'+id)},await key(env),new Uint8Array(bytes)));
}
type RequestRow={id:string,user_id:string|null,session_hash:string|null,identity_hash:string,status:string,account_withdrawn:number,recovery_deadline:number|null,generation:number,encrypted_token:string|null,token_expires_at:number|null,expires_at:number,lock_until:number};
const receipt=(r:Request)=>hash(cookie(r,NAME));
async function row(r:Request,env:Env){return env.DB.prepare('SELECT * FROM withdrawal_requests WHERE id=? AND expires_at>?').bind(await receipt(r),now()).first<RequestRow>();}
const result=(record:RequestRow|null)=>({accountWithdrawn:!!record?.account_withdrawn,recoveryDeadline:record?.recovery_deadline??null,googleRevocation:record?.status==='complete'?'succeeded':record?.status==='unconfirmed'?'unconfirmed':'not_confirmed',status:record?.status||'expired'});

export async function prepareWithdrawal(r:Request,env:Env){
 if(!withdrawalEnabled(env))throw unavailable();
 const user=await session(r,env);if(!user)throw new HttpError(401,'AUTH_REQUIRED','로그인이 필요합니다.');
 const existing=await row(r,env);
 if(existing?.status==='processing')throw new HttpError(409,'WITHDRAWAL_BUSY','탈퇴 결과를 확인해 주세요.');
 const identity=await env.DB.prepare('SELECT google_sub FROM users WHERE id=?').bind(user.id).first<{google_sub:string}>();
 if(!identity)throw new HttpError(401,'AUTH_REQUIRED','로그인이 필요합니다.');
 await rate(env.DB,'withdrawal:'+user.id,5,600);
 const raw=token(),id=await hash(raw),identityKey=await identityHash(env,identity.google_sub);
 if(await env.DB.prepare("SELECT 1 FROM withdrawal_requests WHERE identity_hash=? AND status='processing' AND lock_until>?").bind(identityKey,now()).first())throw new HttpError(409,'WITHDRAWAL_BUSY','탈퇴 결과를 확인해 주세요.');
 await env.DB.batch([
  env.DB.prepare("UPDATE withdrawal_requests SET status='cancelled',encrypted_token=NULL,user_id=NULL,session_hash=NULL WHERE user_id=? AND status IN ('pending','ready')").bind(user.id),
  env.DB.prepare("INSERT INTO withdrawal_requests(id,user_id,session_hash,identity_hash,status,expires_at,generation) SELECT ?,id,?,?,'pending',?,withdrawal_generation FROM users WHERE id=? AND status='active'").bind(id,await hash(cookie(r,'__Host-nodo_session')),identityKey,now()+600,user.id)
 ]);
 const response=json({authorizationUrl:'/auth/google?withdrawal=1&reauth=1'});
 response.headers.append('Set-Cookie',setCookie(NAME,raw,600));return response;
}
export async function withdrawalIntent(r:Request,env:Env){
 if(!withdrawalEnabled(env))throw unavailable();
 const current=await session(r,env),record=await row(r,env);
 if(!current||!record||record.status!=='pending'||record.user_id!==current.id||record.session_hash!==await hash(cookie(r,'__Host-nodo_session')))throw new HttpError(403,'WITHDRAWAL_INVALID','탈퇴 요청을 다시 시작해 주세요.');
 return record.id;
}
export async function finishWithdrawalAuth(r:Request,env:Env,id:string,accessToken:string,expiresIn:number){
 if(await withdrawalIntent(r,env)!==id)throw new Error('withdrawal intent mismatch');
 if(!accessToken||!Number.isFinite(expiresIn)||expiresIn<=0)throw new Error('withdrawal token missing');
 const changed=await env.DB.prepare("UPDATE withdrawal_requests SET encrypted_token=?,token_expires_at=?,status='ready' WHERE id=? AND status='pending' AND expires_at>? RETURNING id").bind(await sealToken(env,id,accessToken),now()+Math.min(expiresIn,600),id,now()).first();
 if(!changed)throw new Error('withdrawal intent consumed');
}
export async function withdrawalStatus(r:Request,env:Env){
 if(!withdrawalEnabled(env))throw unavailable();return json(result(await row(r,env)));
}
export async function cancelWithdrawal(r:Request,env:Env){
 if(!withdrawalEnabled(env))throw unavailable();
 const user=await session(r,env);if(!user)throw new HttpError(401,'AUTH_REQUIRED','로그인이 필요합니다.');
 await env.DB.prepare("UPDATE withdrawal_requests SET status='cancelled',encrypted_token=NULL,user_id=NULL,session_hash=NULL WHERE id=? AND user_id=? AND status IN ('pending','ready')").bind(await receipt(r),user.id).run();
 const response=json({ok:true});response.headers.append('Set-Cookie',setCookie(NAME,'',0));return response;
}
export async function confirmWithdrawal(r:Request,env:Env){
 if(!withdrawalEnabled(env))throw unavailable();
 const user=await session(r,env),record=await row(r,env);
 if(!user||!record||record.status!=='ready'||record.user_id!==user.id||record.session_hash!==await hash(cookie(r,'__Host-nodo_session'))||!record.encrypted_token||!record.token_expires_at||record.token_expires_at<=now())throw new HttpError(403,'REAUTH_REQUIRED','탈퇴 전 Google 계정을 확인해 주세요.');
 // Decrypt before touching the account. A wrong/missing key cannot cause a partial deletion.
 let accessToken:string;
 try{accessToken=await openToken(env,record.id,record.encrypted_token);}catch{throw unavailable();}
 const claimed=await env.DB.prepare("UPDATE withdrawal_requests SET status='processing',lock_until=? WHERE id=? AND status='ready' AND expires_at>? RETURNING id").bind(now()+60,record.id,now()).first();
 if(!claimed)throw new HttpError(409,'WITHDRAWAL_BUSY','이미 처리 중입니다. 결과를 확인해 주세요.');
 const uid=user.id;
 const withdrawnAt=now(),deadline=withdrawnAt+RECOVERY_SECONDS;
 try{
  const changed=await env.DB.batch([
   env.DB.prepare("UPDATE users SET status='withdrawn',withdrawn_at=?,recovery_deadline=?,withdrawal_generation=withdrawal_generation+1,withdrawal_request_id=?,role='user' WHERE id=? AND status='active' AND withdrawal_generation=? RETURNING id").bind(withdrawnAt,deadline,record.id,uid,record.generation),
   env.DB.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE withdrawal_request_id=?)').bind(record.id),
   env.DB.prepare('DELETE FROM oauth_states WHERE reauth_user IN (SELECT id FROM users WHERE withdrawal_request_id=?)').bind(record.id),
   env.DB.prepare('DELETE FROM recovery_tickets WHERE user_id IN (SELECT id FROM users WHERE withdrawal_request_id=?)').bind(record.id),
   env.DB.prepare("UPDATE withdrawal_requests SET encrypted_token=NULL,session_hash=NULL,status=CASE WHEN id=? THEN status ELSE 'cancelled' END WHERE user_id=?").bind(record.id,uid),
   env.DB.prepare('UPDATE withdrawal_requests SET account_withdrawn=1,recovery_deadline=? WHERE id=? AND EXISTS(SELECT 1 FROM users WHERE withdrawal_request_id=?)').bind(deadline,record.id,record.id)
  ]);
  if(!changed[0].results.length)throw new Error('withdrawal state changed');
 }catch{
  // Never revoke after an unconfirmed DB transaction. Keep the outcome inspectable.
  throw new HttpError(503,'WITHDRAWAL_DB_UNCONFIRMED','탈퇴 처리 결과를 확인해 주세요. Google 철회는 실행하지 않았습니다.');
 }
 let status='unconfirmed';
 try{
  const response=await fetch('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:accessToken}).toString(),signal:AbortSignal.timeout(5000),redirect:'manual'});
  if(response.status===200)status='complete';
 }catch{/* No automatic delayed retry: it might revoke a later re-consent. */}
 accessToken='';
 // If this write fails, status remains processing, never falsely successful.
 try{await env.DB.prepare('UPDATE withdrawal_requests SET status=?,lock_until=0,encrypted_token=NULL WHERE id=?').bind(status,record.id).run();}catch{status='unconfirmed';}
 const response=json(result({...record,account_withdrawn:1,recovery_deadline:deadline,status}));
 response.headers.append('Set-Cookie',setCookie('__Host-nodo_session','',0));
 response.headers.append('Set-Cookie',setCookie('__Host-nodo_oauth','',0));return response;
}
export async function cleanWithdrawals(env:Env){
 await env.DB.batch([
  env.DB.prepare("UPDATE withdrawal_requests SET status='unconfirmed',encrypted_token=NULL,lock_until=0 WHERE status='processing' AND lock_until<=?").bind(now()),
  env.DB.prepare('DELETE FROM withdrawal_requests WHERE id IN (SELECT id FROM withdrawal_requests WHERE expires_at<=? LIMIT 1000)').bind(now())
 ]);
}
