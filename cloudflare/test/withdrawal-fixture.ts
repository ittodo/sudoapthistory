import {createHash} from 'node:crypto';
import {sealToken,identityHash} from '../src/withdrawal';
export const withdrawalKey='ab'.repeat(32);
export async function readyWithdrawal(db:any,origin:string,uid:string,sessionToken:string){
 const raw=crypto.randomUUID(),id=createHash('sha256').update(raw).digest('hex');
 const env={SITE_ORIGIN:origin,WITHDRAWAL_ENCRYPTION_KEY:withdrawalKey} as any;
 await db.prepare("INSERT INTO withdrawal_requests(id,user_id,session_hash,identity_hash,status,encrypted_token,token_expires_at,expires_at) VALUES(?,?,?,?,'ready',?,?,?)").bind(id,uid,createHash('sha256').update(sessionToken).digest('hex'),await identityHash(env,'google-'+uid),await sealToken(env,id,'fake-withdrawal-access-token'),Math.floor(Date.now()/1000)+300,Math.floor(Date.now()/1000)+600).run();
 await db.prepare('UPDATE withdrawal_requests SET generation=(SELECT withdrawal_generation FROM users WHERE id=?) WHERE id=?').bind(uid,id).run();
 return {raw,id,cookie:'__Host-nodo_withdrawal='+raw};
}
