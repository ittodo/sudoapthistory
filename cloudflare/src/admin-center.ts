import {pageReport} from './page-analytics';
import {Env,HttpError,json,body,text,hash} from './shared';
import {moderationCutoff} from './comment-retention';
type Row=Record<string,any>;
type Actor={id:string;role:string}|null;
const conflict=()=>new HttpError(409,'CONFLICT','다른 작업으로 상태가 변경되었습니다. 새로고침 후 확인해 주세요.');
const active="EXISTS(SELECT 1 FROM users u WHERE u.id=c.user_id AND u.status='active')";
const auditVersion='(SELECT id FROM admin_audit_log WHERE target_id=c.id ORDER BY rowid DESC LIMIT 1)';
const snapshot=(r:Row)=>JSON.stringify([r.content,r.updated_at,r.deleted_at,r.moderated_at,r.moderation_reason,Number(r.pinned),r.last_audit??null]);
const revision=(r:Row)=>hash(snapshot(r));
const state=(r:Row)=>JSON.stringify({hidden:!!r.moderated_at,pinned:!!r.pinned});
const cutoff=()=>new Date(Date.now()-90*86400000).toISOString();
function offset(p:URLSearchParams){const n=Number(p.get('offset')||0);if(!Number.isSafeInteger(n)||n<0||n>1000000)throw new HttpError(400,'INVALID_INPUT','페이지 범위를 확인해 주세요.');return n;}
function period(p:URLSearchParams){const days=Number(p.get('days')||7);if(![1,7,30].includes(days))throw new HttpError(400,'INVALID_INPUT','기간을 확인해 주세요.');const from=new Date(Date.now()+9*3600000-(days-1)*86400000).toISOString().slice(0,10);return {days,from,utc:from+'T00:00:00+09:00'};}
export async function cleanupAdminAudit(db:D1Database){await db.batch([db.prepare('UPDATE admin_audit_log SET actor_id=NULL WHERE actor_id IN (SELECT id FROM users WHERE status=?)').bind('purging'),db.prepare('DELETE FROM admin_audit_log WHERE id IN (SELECT id FROM admin_audit_log WHERE created_at<? ORDER BY created_at LIMIT 1000)').bind(cutoff())]);}
export async function adminCenter(r:Request,env:Env,user:Actor):Promise<Response|null>{
 const u=new URL(r.url),path=u.pathname,p=u.searchParams;
 const pin=path.match(/^\/api\/board\/posts\/(\d+)\/pin$/),mod=path.match(/^\/api\/admin\/comments\/(\d+)\/moderation$/);
 if(!path.startsWith('/api/admin/')&&!pin)return null;
 if(!user)throw new HttpError(401,'AUTH_REQUIRED','로그인이 필요합니다.');if(user.role!=='admin')throw new HttpError(403,'ADMIN_REQUIRED','운영자 권한이 필요합니다.');
 const q=(sql:string,...v:any[])=>env.DB.prepare(sql).bind(...v),first=(sql:string,...v:any[])=>q(sql,...v).first<Row>(),all=async(sql:string,...v:any[])=>(await q(sql,...v).all<Row>()).results;
 if((pin||mod)&&r.method==='PUT'){
  const id=Number((pin||mod)![1]),b=await body(r),field=pin?'pinned':'hidden';if(typeof b[field]!=='boolean')throw new HttpError(400,'INVALID_INPUT','변경 상태를 확인해 주세요.');
  if(!Number.isSafeInteger(id)||id<1)throw new HttpError(400,'INVALID_INPUT','대상 번호를 확인해 주세요.');
  const reason=mod&&b.hidden?JSON.stringify({category:text(b.category,1,100),detail:typeof b.detail==='string'?text(b.detail,0,1000):''}):null;
  const requestId=r.headers.get('Idempotency-Key')||crypto.randomUUID();if(requestId.length>100)throw new HttpError(400,'INVALID_INPUT','요청 식별자를 확인해 주세요.');
  const requestHash=await hash(JSON.stringify([user.id,path,b]));
  const retry=await first('SELECT request_hash FROM admin_audit_log WHERE request_id=? AND created_at>=?',requestId,cutoff());if(retry){if(retry.request_hash!==requestHash)throw conflict();return json({ok:true,...(pin?{pinned:b.pinned}:{})});}
  const row=await first(`SELECT c.*,EXISTS(SELECT 1 FROM board_pins WHERE comment_id=c.id) pinned,${auditVersion} last_audit FROM comments c WHERE c.id=?`,id);
  if(!row||row.deleted_at||(row.moderated_at&&row.moderated_at<=moderationCutoff()))throw new HttpError(404,'NOT_FOUND','처리할 수 없는 글입니다.');
  if(pin&&(row.page_id!=='community'||row.parent_id!==null||row.moderated_at||!await first("SELECT id FROM users WHERE id=? AND status='active'",row.user_id)))throw new HttpError(404,'NOT_FOUND','공지로 변경할 수 없는 글입니다.');
  if(b.expectedRevision!==undefined&&b.expectedRevision!==await revision(row))throw conflict();
  const after:Row={...row,...(pin?{pinned:b.pinned}:{moderated_at:b.hidden?(row.moderated_at||new Date().toISOString()):null,moderation_reason:reason})};
  // No-op retries from older clients must not create another audit event.
  if(state(row)===state(after)&&row.moderation_reason===after.moderation_reason)return json({ok:true,...(pin?{pinned:b.pinned}:{})});
  const auditId=crypto.randomUUID(),at=new Date().toISOString();
  const insert=q(`INSERT INTO admin_audit_log(id,actor_id,created_at,target_id,page_id,action,before_state,after_state,reason,request_id,request_hash) SELECT ?,?,?,?,?,?,?,?,?,?,? FROM comments c WHERE c.id=? AND c.content IS ? AND c.updated_at IS ? AND c.deleted_at IS ? AND c.moderated_at IS ? AND c.moderation_reason IS ? AND EXISTS(SELECT 1 FROM board_pins WHERE comment_id=c.id)=? AND ${auditVersion} IS ? AND EXISTS(SELECT 1 FROM users WHERE id=? AND status='active' AND role='admin')`,auditId,user.id,at,id,row.page_id,pin?(b.pinned?'pin':'unpin'):(b.hidden?'hide':'restore'),state(row),state(after),reason,requestId,requestHash,id,row.content,row.updated_at,row.deleted_at,row.moderated_at,row.moderation_reason,Number(row.pinned),row.last_audit??null,user.id);
  const gate='EXISTS(SELECT 1 FROM admin_audit_log WHERE id=?)';
  const mutation=pin?(b.pinned?q(`INSERT OR IGNORE INTO board_pins(comment_id) SELECT ? WHERE ${gate}`,id,auditId):q(`DELETE FROM board_pins WHERE comment_id=? AND ${gate}`,id,auditId)):q(`UPDATE comments SET moderated_at=?,moderation_reason=? WHERE id=? AND ${gate}`,after.moderated_at,reason,id,auditId);
  try{await env.DB.batch([insert,mutation]);}catch(error){const existing=await first('SELECT request_hash FROM admin_audit_log WHERE request_id=?',requestId);if(existing?.request_hash===requestHash)return json({ok:true,...(pin?{pinned:b.pinned}:{})});throw error;}
  if(!await first('SELECT id FROM admin_audit_log WHERE id=?',auditId))throw conflict();return json({ok:true,...(pin?{pinned:b.pinned}:{})});
 }
 if(r.method!=='GET')return null;
 if(path==='/api/admin/comments'){
  const status=p.get('status')||'all',kind=p.get('kind')||'all',scope=p.get('scope')||'all',search=(p.get('q')||'').trim();if(search.length>100)throw new HttpError(400,'INVALID_INPUT','검색어는 100자 이하입니다.');
  const conditions:Row={all:'1',normal:`c.deleted_at IS NULL AND c.moderated_at IS NULL AND ${active}`,moderated:'c.deleted_at IS NULL AND c.moderated_at IS NOT NULL',deleted:'c.deleted_at IS NOT NULL',withdrawn:`c.deleted_at IS NULL AND NOT ${active}`};
  const kinds:Row={all:'1',posts:"c.page_id='community' AND c.parent_id IS NULL",comments:"NOT(c.page_id='community' AND c.parent_id IS NULL)"};const scopes:Row={all:'1',apartment:"c.page_id LIKE 'apt_%'",company:"(c.page_id LIKE 'company_%' OR c.page_id='div')",board:"c.page_id='community'"};
  if(!Object.hasOwn(conditions,status)||!Object.hasOwn(kinds,kind)||!Object.hasOwn(scopes,scope))throw new HttpError(400,'INVALID_INPUT','필터를 확인해 주세요.');
  const where=`${conditions[status]} AND ${kinds[kind]} AND ${scopes[scope]} AND (?='' OR instr(lower(c.content),lower(?))>0 OR instr(lower(coalesce(p.nickname,'')),lower(?))>0) AND (?='' OR c.page_id=?) AND c.created_at>=?`;
  const args=[search,search,search,p.get('page_id')||'',p.get('page_id')||'',p.get('days')?new Date(period(p).utc).toISOString():'0000'];const n=offset(p);
  const rows=await all(`SELECT c.*,p.nickname,u.status author_status,EXISTS(SELECT 1 FROM board_pins WHERE comment_id=c.id) pinned,${auditVersion} last_audit FROM comments c LEFT JOIN profiles p ON p.user_id=c.user_id LEFT JOIN users u ON u.id=c.user_id WHERE ${where} ORDER BY c.id DESC LIMIT 20 OFFSET ?`,...args,n);
  const data=await Promise.all(rows.map(async c=>({...c,request_key:undefined,request_hash:undefined,revision:await revision(c),content:c.deleted_at?'삭제된 글입니다.':c.author_status!=='active'?'탈퇴한 회원의 글입니다.':c.content,moderation_reason:c.moderation_reason?JSON.parse(c.moderation_reason):null})));
  return json({data,count:(await first(`SELECT count(*) count FROM comments c LEFT JOIN profiles p ON p.user_id=c.user_id WHERE ${where}`,...args))!.count});
 }
 if(path==='/api/admin/page-analytics')return json(await pageReport(env,period(p).days));
 if(path==='/api/admin/overview'){
  const t=period(p),from=new Date(t.utc).toISOString();
  const counts=await first(`SELECT coalesce(sum(page_id='community' AND parent_id IS NULL),0) posts,coalesce(sum(NOT(page_id='community' AND parent_id IS NULL)),0) comments,coalesce(sum(moderated_at IS NOT NULL AND deleted_at IS NULL),0) hidden,coalesce(sum(page_id='community' AND parent_id IS NULL AND moderated_at IS NOT NULL AND deleted_at IS NULL),0) hiddenPosts,coalesce(sum(NOT(page_id='community' AND parent_id IS NULL) AND moderated_at IS NOT NULL AND deleted_at IS NULL),0) hiddenComments FROM comments WHERE created_at>=?`,from);
  const usage=await first('SELECT coalesce(sum(views),0) views,coalesce(sum(hearts),0) hearts,coalesce(sum(calculators),0) calculators FROM apartment_daily WHERE day>=?',t.from);
  return json({...t,counts,usage});
 }
 if(path==='/api/admin/audit'){
  const action=p.get('action')||'',target=p.get('target')||'';if(!['','hide','restore','pin','unpin'].includes(action)||target&&!/^\d+$/.test(target))throw new HttpError(400,'INVALID_INPUT','필터를 확인해 주세요.');
  const where="a.created_at>=? AND (?='' OR a.action=?) AND (?='' OR a.target_id=?)",args=[cutoff(),action,action,target,target];
  return json({data:await all(`SELECT a.id,a.actor_id,p.nickname,a.created_at,a.target_id,a.page_id,a.action,a.before_state,a.after_state,a.reason FROM admin_audit_log a LEFT JOIN profiles p ON p.user_id=a.actor_id WHERE ${where} ORDER BY a.created_at DESC,a.id DESC LIMIT 20 OFFSET ?`,...args,offset(p)),count:(await first(`SELECT count(*) count FROM admin_audit_log a WHERE ${where}`,...args))!.count});
 }
 if(path==='/api/admin/status'){
  let data:Row[];try{const res=await env.ASSETS.fetch(new Request(new URL('/data/operations-status.json',env.SITE_ORIGIN)));if(!res.ok)throw Error();const meta=await res.json() as Row;if(meta.schema!==1||!Array.isArray(meta.data))throw Error();data=meta.data;}catch{data=[{name:'배포 자료 목록',status:'error',path:'/data/operations-status.json'}];}
  await first('SELECT 1');return json({checkedAt:new Date().toISOString(),gitSha:env.RELEASE_SHA,workerVersion:env.CF_VERSION_METADATA?.id||null,maintenance:env.MAINTENANCE==='true',data});
 }
 return null;
}
