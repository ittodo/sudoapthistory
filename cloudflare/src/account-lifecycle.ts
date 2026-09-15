import {Env,HttpError,now,token,hash,cookie,setCookie,json,rate} from './shared';
export const RECOVERY_SECONDS=30*24*60*60;
const RECOVERY_COOKIE='__Host-nodo_recovery';
const blocked=new HttpError(409,'RECOVERY_UNAVAILABLE','복구 가능 기간이 지났거나 처리 중입니다.');

// No bulk backup or DB rewind. Identity release is atomic with the irreversible state transition.
export async function expireAccounts(db:D1Database,time=now(),specificId?:string){
 const selection=specificId?'id=?':'id IN (SELECT id FROM users WHERE status=\'withdrawn\' AND recovery_deadline<=? ORDER BY recovery_deadline LIMIT 20)';
 await db.batch([
  db.prepare(`UPDATE users SET status='purging',google_sub='purged:'||id,email='',role='user' WHERE status='withdrawn' AND recovery_deadline<=? AND ${selection}`).bind(time,specificId??time),
  db.prepare(`DELETE FROM profiles WHERE user_id IN (SELECT id FROM users WHERE status='purging'${specificId?' AND id=?':''} LIMIT 20)`).bind(...(specificId?[specificId]:[]))
 ]);
}
export async function purgeAccounts(db:D1Database,time=now()){
 await expireAccounts(db,time);
 const users=(await db.prepare("SELECT id FROM users WHERE status='purging' ORDER BY id LIMIT 5").all<{id:string}>()).results;
 for(const {id} of users){
  await db.batch([
   db.prepare('DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions WHERE user_id=? LIMIT 500)').bind(id),
   db.prepare('DELETE FROM oauth_states WHERE state_hash IN (SELECT state_hash FROM oauth_states WHERE reauth_user=? LIMIT 500)').bind(id),
   db.prepare('DELETE FROM recovery_tickets WHERE token_hash IN (SELECT token_hash FROM recovery_tickets WHERE user_id=? LIMIT 500)').bind(id),
   db.prepare('DELETE FROM profiles WHERE user_id=?').bind(id),
   db.prepare('DELETE FROM apartment_favorites WHERE user_id=?').bind(id),
   db.prepare('DELETE FROM saved_calculations WHERE user_id=?').bind(id),
   db.prepare('DELETE FROM comment_likes WHERE rowid IN (SELECT rowid FROM comment_likes WHERE user_id=? LIMIT 500)').bind(id),
   db.prepare('DELETE FROM comment_likes WHERE rowid IN (SELECT l.rowid FROM comment_likes l JOIN comments c ON c.id=l.comment_id WHERE c.user_id=? LIMIT 500)').bind(id),
   db.prepare('DELETE FROM tag_votes WHERE rowid IN (SELECT rowid FROM tag_votes WHERE user_id=? LIMIT 500)').bind(id),
   // Wait for incoming likes before detaching each comment so subsequent passes can still find them.
   db.prepare("UPDATE comments SET content='',user_id=NULL,request_key=NULL,request_hash=NULL,moderation_reason=NULL,updated_at=NULL,deleted_at=COALESCE(deleted_at,?) WHERE id IN (SELECT c.id FROM comments c WHERE c.user_id=? AND NOT EXISTS(SELECT 1 FROM comment_likes l WHERE l.comment_id=c.id) LIMIT 500)").bind(new Date(time*1000).toISOString(),id),
   db.prepare('UPDATE tags SET created_by=NULL WHERE id IN (SELECT id FROM tags WHERE created_by=? LIMIT 500)').bind(id),
   db.prepare('DELETE FROM rate_limits WHERE key IN (SELECT key FROM rate_limits WHERE key LIKE ? OR key LIKE ? OR key LIKE ? OR key LIKE ? LIMIT 500)').bind('write:'+id+':%','tags:'+id+':%','withdrawal:'+id+':%','recovery:'+id+':%'),
   db.prepare("UPDATE withdrawal_requests SET user_id=NULL,session_hash=NULL,encrypted_token=NULL WHERE id IN (SELECT id FROM withdrawal_requests WHERE user_id=? LIMIT 500)").bind(id),
   db.prepare(`DELETE FROM users WHERE id=? AND status='purging'
    AND NOT EXISTS(SELECT 1 FROM comments WHERE user_id=users.id)
    AND NOT EXISTS(SELECT 1 FROM comment_likes WHERE user_id=users.id)
    AND NOT EXISTS(SELECT 1 FROM tag_votes WHERE user_id=users.id)
    AND NOT EXISTS(SELECT 1 FROM tags WHERE created_by=users.id)
    AND NOT EXISTS(SELECT 1 FROM sessions WHERE user_id=users.id)
    AND NOT EXISTS(SELECT 1 FROM oauth_states WHERE reauth_user=users.id)
    AND NOT EXISTS(SELECT 1 FROM recovery_tickets WHERE user_id=users.id)
    AND NOT EXISTS(SELECT 1 FROM withdrawal_requests WHERE user_id=users.id)`).bind(id)
  ]);
 }
 await db.prepare('DELETE FROM recovery_tickets WHERE token_hash IN (SELECT token_hash FROM recovery_tickets WHERE expires_at<=? LIMIT 1000)').bind(time).run();
}
export async function issueRecovery(env:Env,uid:string){
 const raw=token();await rate(env.DB,'recovery:'+uid,5,600);
 const issued=await env.DB.prepare(`INSERT INTO recovery_tickets(token_hash,user_id,generation,expires_at)
 SELECT ?,id,withdrawal_generation,? FROM users WHERE id=? AND status='withdrawn' AND recovery_deadline>?
 AND NOT EXISTS(SELECT 1 FROM withdrawal_requests w WHERE w.user_id=users.id AND w.status='processing' AND w.lock_until>?) RETURNING token_hash`).bind(await hash(raw),now()+600,uid,now(),now()).first();
 if(!issued)throw blocked;
 const response=new Response(null,{status:302,headers:{Location:env.SITE_ORIGIN+'/account/?recovery=confirm','Cache-Control':'no-store'}});
 response.headers.append('Set-Cookie',setCookie(RECOVERY_COOKIE,raw,600));
 response.headers.append('Set-Cookie',setCookie('__Host-nodo_session','',0));
 response.headers.append('Set-Cookie',setCookie('__Host-nodo_oauth','',0));return response;
}
export async function recoveryRoute(r:Request,env:Env){
 const raw=cookie(r,RECOVERY_COOKIE),ticket=await hash(raw),time=now();
 if(r.method==='GET'){
  const row=raw?await env.DB.prepare(`SELECT u.recovery_deadline FROM recovery_tickets t JOIN users u ON u.id=t.user_id
   WHERE t.token_hash=? AND t.expires_at>? AND t.consumed_session_hash IS NULL AND t.generation=u.withdrawal_generation
   AND u.status='withdrawn' AND u.recovery_deadline>?
   AND NOT EXISTS(SELECT 1 FROM withdrawal_requests w WHERE w.user_id=u.id AND w.status='processing' AND w.lock_until>?)`).bind(ticket,time,time,time).first<{recovery_deadline:number}>():null;
  return json({recoverable:!!row,recoveryDeadline:row?.recovery_deadline??null,csrfToken:raw?await hash('recovery-csrf:'+raw):null});
 }
 if(r.method!=='POST')throw new HttpError(405,'METHOD','지원하지 않는 요청입니다.');
 if(env.MAINTENANCE==='true')throw new HttpError(503,'MAINTENANCE','서비스 점검 중입니다.');
 if(!raw||r.headers.get('Origin')!==env.SITE_ORIGIN||r.headers.get('X-CSRF-Token')!==await hash('recovery-csrf:'+raw))throw new HttpError(403,'CSRF','복구 화면을 다시 열어 주세요.');
 if(new URL(r.url).pathname.endsWith('/cancel')){
  await env.DB.prepare('DELETE FROM recovery_tickets WHERE token_hash=?').bind(ticket).run();
  const response=json({ok:true});response.headers.append('Set-Cookie',setCookie(RECOVERY_COOKIE,'',0));return response;
 }
 const sessionToken=token(),sessionHash=await hash(sessionToken);
 const results=await env.DB.batch([
  env.DB.prepare(`UPDATE recovery_tickets SET consumed_session_hash=? WHERE token_hash=? AND consumed_session_hash IS NULL AND expires_at>?
   AND EXISTS(SELECT 1 FROM users u WHERE u.id=recovery_tickets.user_id AND u.status='withdrawn' AND u.recovery_deadline>? AND u.withdrawal_generation=recovery_tickets.generation
   AND NOT EXISTS(SELECT 1 FROM withdrawal_requests w WHERE w.user_id=u.id AND w.status='processing' AND w.lock_until>?)) RETURNING user_id`).bind(sessionHash,ticket,time,time,time),
  env.DB.prepare(`UPDATE users SET status='active',withdrawn_at=NULL,recovery_deadline=NULL,role='user'
   WHERE status='withdrawn' AND recovery_deadline>? AND EXISTS(SELECT 1 FROM recovery_tickets t WHERE t.token_hash=? AND t.user_id=users.id AND t.generation=users.withdrawal_generation AND t.consumed_session_hash=?)`).bind(time,ticket,sessionHash),
  env.DB.prepare(`INSERT INTO sessions(token_hash,user_id,expires_at,authenticated_at)
   SELECT ?,u.id,?,? FROM users u JOIN recovery_tickets t ON t.user_id=u.id WHERE t.token_hash=? AND t.consumed_session_hash=? AND u.status='active' AND u.withdrawal_generation=t.generation`).bind(sessionHash,time+604800,time,ticket,sessionHash)
 ]);
 if(!results[0].results.length)throw blocked;
 const response=json({restored:true});response.headers.append('Set-Cookie',setCookie('__Host-nodo_session',sessionToken,604800));
 response.headers.append('Set-Cookie',setCookie(RECOVERY_COOKIE,'',0));return response;
}
