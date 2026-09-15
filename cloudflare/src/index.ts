import {adminCenter,cleanupAdminAudit} from './admin-center';
import {auth} from './auth';
import {libraryRoute,collectEvent,cleanupAnalytics} from './member-library';
import {moderationCutoff,purgeExpiredComments} from './comment-retention';
import {prepareWithdrawal,confirmWithdrawal,cancelWithdrawal,withdrawalStatus,cleanWithdrawals} from './withdrawal';
import {expireAccounts,purgeAccounts,recoveryRoute} from './account-lifecycle';
import {Env,HttpError,json,body,text,session,hash,cookie,setCookie,now,rate} from './shared';
type Row=Record<string,any>;
const statement=(env:Env,sql:string,...values:any[])=>env.DB.prepare(sql).bind(...values);
const first=(env:Env,sql:string,...values:any[])=>statement(env,sql,...values).first<Row>();
const all=async(env:Env,sql:string,...values:any[])=>(await statement(env,sql,...values).all<Row>()).results;
const timestamp=()=>new Date().toISOString();
const activeAuthor="EXISTS(SELECT 1 FROM users author WHERE author.id=c.user_id AND author.status='active')";
const visible=`c.deleted_at IS NULL AND c.moderated_at IS NULL AND ${activeAuthor} AND (c.parent_id IS NULL OR EXISTS(SELECT 1 FROM comments p WHERE p.id=c.parent_id AND p.moderated_at IS NULL))`;
// Deleted roots are placeholders only while a visible reply survives. Moderation still hides the thread.
const rootVisible=`c.moderated_at IS NULL AND ((c.deleted_at IS NULL AND ${activeAuthor}) OR EXISTS(SELECT 1 FROM comments child JOIN users child_author ON child_author.id=child.user_id AND child_author.status='active' WHERE child.parent_id=c.id AND child.deleted_at IS NULL AND child.moderated_at IS NULL))`;
const commentSelect=`SELECT c.*,p.nickname,p.avatar_url,u.status author_status,(SELECT count(*) FROM comment_likes l JOIN users voter ON voter.id=l.user_id AND voter.status='active' WHERE l.comment_id=c.id) like_count,EXISTS(SELECT 1 FROM comment_likes l WHERE l.comment_id=c.id AND l.user_id=?) liked FROM comments c LEFT JOIN profiles p ON p.user_id=c.user_id LEFT JOIN users u ON u.id=c.user_id`;
const shape=(row:Row)=>{const withdrawn=!!row.user_id&&row.author_status!=='active',hidden=!!row.deleted_at||withdrawn;return {id:row.id,user_id:hidden?null:row.user_id,page_id:row.page_id,content:row.deleted_at?'삭제된 댓글입니다.':withdrawn?'탈퇴한 회원의 댓글입니다.':row.content,is_deleted:hidden,is_withdrawn:withdrawn,parent_id:row.parent_id,created_at:row.created_at,updated_at:hidden?null:row.updated_at,profiles:{nickname:row.deleted_at?'삭제된 댓글':withdrawn?'탈퇴한 회원':row.nickname||'탈퇴한 회원',avatar_url:hidden?null:row.avatar_url||null},comment_likes:[{count:hidden?0:row.like_count}],liked:!hidden&&!!row.liked};};
function integer(value:string|null,fallback:number,max:number){if(value===null)return fallback;const n=Number(value);if(!Number.isSafeInteger(n)||n<0||n>max)throw new HttpError(400,'INVALID_INPUT','잘못된 범위입니다.');return n}
function validateBoardPost(content:string){const split=content.indexOf('\n');if(split<2||split>120||!content.slice(split+1).trim())throw new HttpError(400,'INVALID_INPUT','제목은 2~120자, 내용은 1자 이상 입력해 주세요.');}
const notFound=()=>new HttpError(404,'NOT_FOUND','찾을 수 없습니다.');
async function route(r:Request,env:Env):Promise<Response>{
 const url=new URL(r.url),path=url.pathname,method=r.method;
 if(path.startsWith('/auth/'))return auth(r,env);
 if(!path.startsWith('/api/'))return env.ASSETS.fetch(r);
 if(path==='/api/account/withdrawal/status'&&method==='GET')return withdrawalStatus(r,env);
 if(['/api/account/recovery','/api/account/recovery/confirm','/api/account/recovery/cancel'].includes(path)){
  if((path==='/api/account/recovery')!==(method==='GET'))throw new HttpError(405,'METHOD','지원하지 않는 요청입니다.');
  return recoveryRoute(r,env);
 }
 if(path==='/api/health'&&method==='GET'){const schema=await first(env,'SELECT version FROM schema_metadata');if(schema?.version!==2)throw new HttpError(503,'SCHEMA_UNSUPPORTED','데이터베이스 준비 상태를 확인해 주세요.');await first(env,'SELECT withdrawal_generation FROM users LIMIT 1');await first(env,'SELECT token_hash FROM recovery_tickets LIMIT 1');return json({status:'ok',gitSha:env.RELEASE_SHA,workerVersionId:env.CF_VERSION_METADATA?.id||null,schemaVersion:schema.version,maintenance:env.MAINTENANCE==='true'})}
 if(path==='/api/apartments/events')return collectEvent(r,env);
 const user=await session(r,env);const uid=user?.id||'';
 if(path==='/api/session'&&method==='GET')return json({session:user?{user:{id:user.id,email:user.email}}:null,profile:user?await first(env,'SELECT * FROM profiles WHERE user_id=?',uid):null,isAdmin:user?.role==='admin',csrfToken:user?.csrfToken||null});
 const writing=!['GET','HEAD'].includes(method);
 if(writing){
  if(env.MAINTENANCE==='true')throw new HttpError(503,'MAINTENANCE','서비스 점검 중입니다.');
  if(r.headers.get('Origin')!==env.SITE_ORIGIN)throw new HttpError(403,'ORIGIN','허용되지 않은 출처입니다.');
  if(!user)throw new HttpError(401,'AUTH_REQUIRED','로그인이 필요합니다.');
  if(r.headers.get('X-CSRF-Token')!==user.csrfToken)throw new HttpError(403,'CSRF','페이지를 새로고침해 주세요.');
  await rate(env.DB,'write:'+uid,30,60);
 }
 const admin=await adminCenter(r,env,user);if(admin)return admin;
 const library=await libraryRoute(r,env,user);if(library)return library;
 if(path==='/api/logout'&&method==='POST'){await statement(env,'DELETE FROM sessions WHERE token_hash=?',await hash(cookie(r,'__Host-nodo_session'))).run();const res=json({ok:true});res.headers.append('Set-Cookie',setCookie('__Host-nodo_session','',0));return res}
 if(path==='/api/profile'){
  // Release only the expired account owning this nickname, not all accounts on each read.
  if(url.searchParams.has('nickname')){const owner=await first(env,"SELECT u.id FROM users u JOIN profiles p ON p.user_id=u.id WHERE p.nickname=? AND u.status='withdrawn' AND u.recovery_deadline<=?",url.searchParams.get('nickname'),now());if(owner)await expireAccounts(env.DB,now(),owner.id);}
  if(method==='GET'&&url.searchParams.has('nickname')){const name=text(url.searchParams.get('nickname'),2,20);return json({available:!await first(env,'SELECT 1 FROM profiles WHERE nickname=? AND user_id<>?',name,uid)})}
  if(!user)throw new HttpError(401,'AUTH_REQUIRED','로그인이 필요합니다.');
  if(method==='GET')return json({profile:await first(env,'SELECT * FROM profiles WHERE user_id=?',uid)});
  if(method==='PATCH'){const b=await body(r),name=text(b.nickname,2,20);if(!/^[가-힣a-zA-Z0-9_-]+$/.test(name))throw new HttpError(400,'INVALID_INPUT','닉네임은 한글, 영문, 숫자, 밑줄, 하이픈만 사용할 수 있습니다.');const owner=await first(env,"SELECT u.id FROM users u JOIN profiles p ON p.user_id=u.id WHERE p.nickname=? AND u.status='withdrawn' AND u.recovery_deadline<=?",name,now());if(owner)await expireAccounts(env.DB,now(),owner.id);await statement(env,"INSERT INTO profiles(user_id,nickname) SELECT id,? FROM users WHERE id=? AND status='active' ON CONFLICT(user_id) DO UPDATE SET nickname=excluded.nickname",name,uid).run();return json({profile:await first(env,'SELECT * FROM profiles WHERE user_id=?',uid)})}
 }
 if(path==='/api/account/withdrawal/start'&&method==='POST')return prepareWithdrawal(r,env);
 if(path==='/api/account/withdrawal/cancel'&&method==='POST')return cancelWithdrawal(r,env);
 if((path==='/api/account'&&method==='DELETE')||(path==='/api/account/withdrawal/confirm'&&method==='POST'))return confirmWithdrawal(r,env);
 if(path==='/api/board/posts'&&method==='GET'){
  const query=(url.searchParams.get('q')||'').trim();if(query.length>100)throw new HttpError(400,'INVALID_INPUT','검색어는 100자 이하로 입력해 주세요.');
  const offset=integer(url.searchParams.get('offset'),0,1000000),limit=20;
  const hidden=url.searchParams.get('hidden')==='1';if(hidden&&user?.role!=='admin')throw new HttpError(403,'ADMIN_REQUIRED','관리자 권한이 필요합니다.');
  const where=`c.page_id='community' AND c.parent_id IS NULL AND c.deleted_at IS NULL AND ${activeAuthor} AND ${hidden?'c.moderated_at IS NOT NULL':'c.moderated_at IS NULL'} AND (?='' OR instr(lower(c.content),lower(?))>0)`;
  const data=await all(env,`SELECT c.id,c.content,c.created_at,c.updated_at,c.user_id,p.nickname,c.moderated_at,EXISTS(SELECT 1 FROM board_pins bp WHERE bp.comment_id=c.id) pinned,(SELECT count(*) FROM comments reply JOIN users author ON author.id=reply.user_id AND author.status='active' WHERE reply.parent_id=c.id AND reply.deleted_at IS NULL AND reply.moderated_at IS NULL) reply_count FROM comments c JOIN users u ON u.id=c.user_id LEFT JOIN profiles p ON p.user_id=c.user_id WHERE ${where} ORDER BY pinned DESC,c.created_at DESC,c.id DESC LIMIT ? OFFSET ?`,query,query,limit,offset);
  return json({data:data.map(c=>({...c,title:String(c.content).split('\n')[0],content:undefined})),count:(await first(env,`SELECT count(*) count FROM comments c WHERE ${where}`,query,query))!.count});
 }
 const boardPost=path.match(/^\/api\/board\/posts\/(\d+)(\/pin)?$/);
 if(boardPost){
  const id=Number(boardPost[1]);if(!Number.isSafeInteger(id))throw notFound();
  if(boardPost[2]&&method==='PUT'){
   if(user?.role!=='admin')throw new HttpError(403,'ADMIN_REQUIRED','관리자 권한이 필요합니다.');
   const b=await body(r);if(typeof b.pinned!=='boolean')throw new HttpError(400,'INVALID_INPUT','공지 상태를 확인해 주세요.');
   if(!await first(env,`SELECT 1 FROM comments c WHERE c.id=? AND c.page_id='community' AND c.parent_id IS NULL AND ${visible}`,id))throw notFound();
   if(b.pinned)await statement(env,'INSERT OR IGNORE INTO board_pins(comment_id) VALUES(?)',id).run();else await statement(env,'DELETE FROM board_pins WHERE comment_id=?',id).run();
   return json({ok:true,pinned:b.pinned});
  }
  if(!boardPost[2]&&method==='GET'){
   const row=await first(env,commentSelect+` WHERE c.id=? AND c.page_id='community' AND c.parent_id IS NULL AND ${rootVisible}`,uid,id);if(!row)throw notFound();
   return json({data:{...shape(row),pinned:!!await first(env,'SELECT 1 FROM board_pins WHERE comment_id=?',id)}});
  }
  throw new HttpError(405,'METHOD','지원하지 않는 요청입니다.');
 }
 if(path==='/api/comments/focus'&&method==='GET'){
  const id=integer(url.searchParams.get('id'),0,Number.MAX_SAFE_INTEGER),page=text(url.searchParams.get('page_id'),1,200);
  const target=await first(env,commentSelect+` WHERE c.id=? AND c.page_id=? AND ${visible}`,uid,id,page);if(!target)throw notFound();
  const parent=target.parent_id?await first(env,commentSelect+` WHERE c.id=? AND c.page_id=? AND ${rootVisible}`,uid,target.parent_id,page):null;
  return json({data:[...(parent?[shape(parent)]:[]),shape(target)]});
 }
 if(path==='/api/comments'&&method==='GET'){
  const page=text(url.searchParams.get('page_id'),1,200),offset=integer(url.searchParams.get('offset'),0,1000000),limit=integer(url.searchParams.get('limit'),20,100)||20;
  const roots=await all(env,commentSelect+` WHERE c.page_id=? AND c.parent_id IS NULL AND ${rootVisible} ORDER BY c.created_at DESC,c.id DESC LIMIT ? OFFSET ?`,uid,page,limit,offset);
  const count=await first(env,`SELECT count(*) count FROM comments c WHERE c.page_id=? AND c.parent_id IS NULL AND ${rootVisible}`,page);
  const preview=roots.length?Math.min(3,Math.floor((100-roots.length)/roots.length)):0;
  let replies:Row[]=[],counts:Row[]=[];
  if(roots.length){
   const placeholders=roots.map(()=>'?').join(',');
   counts=await all(env,`SELECT c.parent_id,count(*) count FROM comments c WHERE c.parent_id IN (${placeholders}) AND ${visible} GROUP BY c.parent_id`,...roots.map(c=>c.id));
   if(preview)replies=await all(env,`WITH selected AS (SELECT c.id,ROW_NUMBER() OVER(PARTITION BY c.parent_id ORDER BY c.created_at,c.id) rn FROM comments c WHERE c.parent_id IN (${placeholders}) AND ${visible}) `+commentSelect+` JOIN selected ON selected.id=c.id WHERE selected.rn<=? ORDER BY c.created_at,c.id`,...roots.map(c=>c.id),uid,preview);
  }
  return json({data:roots.flatMap(root=>{const children=replies.filter(reply=>reply.parent_id===root.id);return [{...shape(root),reply_count:counts.find(c=>c.parent_id===root.id)?.count||0,reply_preview_count:children.length},...children.map(shape)]}),count:count?.count||0});
 }
 const repliesPath=path.match(/^\/api\/comments\/(\d+)\/replies$/);
 if(repliesPath&&method==='GET'){
  const id=Number(repliesPath[1]);if(!await first(env,`SELECT c.id FROM comments c WHERE c.id=? AND c.parent_id IS NULL AND ${rootVisible}`,id))throw notFound();
  const data=await all(env,commentSelect+` WHERE c.parent_id=? AND ${visible} ORDER BY c.created_at,c.id LIMIT ? OFFSET ?`,uid,id,integer(url.searchParams.get('limit'),20,100)||20,integer(url.searchParams.get('offset'),0,1000000));
  return json({data:data.map(shape),count:(await first(env,`SELECT count(*) count FROM comments c WHERE c.parent_id=? AND ${visible}`,id))!.count});
 }
 if(path==='/api/comments'&&method==='POST'){
  const b=await body(r),page=text(b.page_id,1,200),content=text(b.content,1,1000);
  if(!await first(env,'SELECT 1 FROM profiles WHERE user_id=?',uid))throw new HttpError(400,'PROFILE_REQUIRED','닉네임을 먼저 설정해 주세요.');
  const parent=b.parent_id??null;if(parent!==null&&(!Number.isSafeInteger(parent)||Number(parent)<1))throw new HttpError(400,'INVALID_INPUT','잘못된 답글 대상입니다.');
  if(page==='community'&&parent===null)validateBoardPost(content);
  const key=r.headers.get('Idempotency-Key');if(!key||!/^[A-Za-z0-9_-]{16,100}$/.test(key))throw new HttpError(400,'IDEMPOTENCY_REQUIRED','요청 식별자가 필요합니다.');
  const requestKey=uid+':'+key,requestHash=await hash(JSON.stringify([page,content,parent]));
  const existing=await first(env,'SELECT id,request_hash FROM comments WHERE request_key=?',requestKey);
  if(existing){if(existing.request_hash!==requestHash)throw new HttpError(409,'IDEMPOTENCY_CONFLICT','다른 내용에 같은 요청 식별자를 사용할 수 없습니다.');return json({data:shape((await first(env,commentSelect+' WHERE c.id=?',uid,existing.id))!)});}
  const row=await first(env,`INSERT INTO comments(user_id,page_id,content,parent_id,request_key,request_hash) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND status='active') AND (? IS NULL OR EXISTS(SELECT 1 FROM comments c WHERE c.id=? AND c.page_id=? AND c.parent_id IS NULL AND c.deleted_at IS NULL AND c.moderated_at IS NULL AND ${activeAuthor})) ON CONFLICT(request_key) DO UPDATE SET request_key=excluded.request_key WHERE comments.request_hash=excluded.request_hash RETURNING id`,uid,page,content,parent,requestKey,requestHash,uid,parent,parent,page);
  if(!row)throw notFound();return json({data:shape((await first(env,commentSelect+' WHERE c.id=?',uid,row.id))!)},201);
 }
 const comment=path.match(/^\/api\/comments\/(\d+)(\/like)?$/);
 if(comment){
  const id=Number(comment[1]);if(!Number.isSafeInteger(id))throw notFound();
  if(comment[2]&&method==='PUT'){
   const b=await body(r);if(typeof b.liked!=='boolean')throw new HttpError(400,'INVALID_INPUT','추천 상태가 필요합니다.');
   if(!await first(env,`SELECT 1 FROM comments c WHERE c.id=? AND ${visible}`,id))throw notFound();
   if(b.liked)await statement(env,`INSERT OR IGNORE INTO comment_likes(comment_id,user_id) SELECT c.id,? FROM comments c WHERE c.id=? AND ${visible} AND EXISTS(SELECT 1 FROM users WHERE id=? AND status='active')`,uid,id,uid).run();
   else await statement(env,"DELETE FROM comment_likes WHERE comment_id=? AND user_id=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND status='active')",id,uid,uid).run();
   return json({ok:true,liked:b.liked,count:(await first(env,"SELECT count(*) count FROM comment_likes l JOIN users u ON u.id=l.user_id AND u.status='active' WHERE comment_id=?",id))!.count});
  }
  if(!comment[2]&&(method==='PATCH'||method==='DELETE')){
   if(method==='DELETE'){
    const results=await env.DB.batch([
     statement(env,"DELETE FROM comment_likes WHERE comment_id IN (SELECT id FROM comments WHERE id=? AND user_id=? AND deleted_at IS NULL) AND EXISTS(SELECT 1 FROM users WHERE id=? AND status='active')",id,uid,uid),
     statement(env,"UPDATE comments SET content='',user_id=NULL,request_key=NULL,request_hash=NULL,moderation_reason=NULL,updated_at=NULL,deleted_at=? WHERE id=? AND user_id=? AND deleted_at IS NULL AND EXISTS(SELECT 1 FROM users WHERE id=? AND status='active') RETURNING id",timestamp(),id,uid,uid)
    ]);
    if(!results[1].results.length)throw notFound();return json({ok:true});
   }
   const b=await body(r);const content=text(b.content,1,1000);const before=await first(env,'SELECT page_id,parent_id FROM comments WHERE id=? AND user_id=?',id,uid);if(before?.page_id==='community'&&before.parent_id===null)validateBoardPost(content);const row=await first(env,`UPDATE comments AS c SET content=?,updated_at=? WHERE id=? AND user_id=? AND ${visible} RETURNING id`,content,timestamp(),id,uid);
   if(!row)throw notFound();return json({data:shape((await first(env,commentSelect+' WHERE c.id=?',uid,id))!)});
  }
 }
 const stock=path.match(/^\/api\/stocks\/(\d{6})\/tags$/);
 if(stock){const ticker=stock[1];
  if(method==='GET'){
   const rows=await all(env,`SELECT st.id stock_tag_id,t.id,t.name,t.slug,t.category,t.status,t.color,t.created_at,CASE WHEN creator.status='active' THEN t.created_by ELSE NULL END created_by,(SELECT count(*) FROM tag_votes v JOIN users voter ON voter.id=v.user_id AND voter.status='active' WHERE v.tag_id=t.id AND vote_type='up') upvotes,(SELECT count(*) FROM tag_votes v JOIN users voter ON voter.id=v.user_id AND voter.status='active' WHERE v.tag_id=t.id AND vote_type='down') downvotes,(SELECT vote_type FROM tag_votes v WHERE v.tag_id=t.id AND user_id=?) my_vote FROM stock_tags st JOIN tags t ON t.id=st.tag_id LEFT JOIN users creator ON creator.id=t.created_by WHERE st.ticker=? ORDER BY t.id LIMIT 100`,uid,ticker);
   return json({data:rows.map(t=>({id:t.stock_tag_id,tag_id:t.id,tags:t})),votes:Object.fromEntries(rows.filter(t=>t.my_vote).map(t=>[t.id,t.my_vote]))});
  }
  if(method==='POST'){
   const b=await body(r),name=text(b.name,2,30);await rate(env.DB,'tags:'+uid,20,86400);
   await env.DB.batch([
    statement(env,"INSERT INTO tags(name,slug,created_by) SELECT ?,?,id FROM users WHERE id=? AND status='active' ON CONFLICT(name) DO NOTHING",name,crypto.randomUUID(),uid),
    statement(env,"INSERT OR IGNORE INTO stock_tags(ticker,tag_id) SELECT ?,id FROM tags WHERE name=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND status='active')",ticker,name,uid),
    statement(env,`INSERT INTO tag_votes(tag_id,user_id,vote_type) SELECT id,?,'up' FROM tags WHERE name=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND status='active') ON CONFLICT(tag_id,user_id) DO UPDATE SET vote_type='up'`,uid,name,uid)
   ]);return json({data:await first(env,'SELECT id,name FROM tags WHERE name=?',name)},201);
  }
 }
 const vote=path.match(/^\/api\/tags\/(\d+)\/vote$/);
 if(vote&&method==='PUT'){const id=Number(vote[1]),b=await body(r);if(![null,'up','down'].includes(b.vote as any))throw new HttpError(400,'INVALID_INPUT','잘못된 투표입니다.');if(!await first(env,'SELECT 1 FROM tags WHERE id=?',id))throw notFound();if(b.vote===null)await statement(env,"DELETE FROM tag_votes WHERE tag_id=? AND user_id=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND status='active')",id,uid,uid).run();else await statement(env,"INSERT INTO tag_votes(tag_id,user_id,vote_type) SELECT ?,id,? FROM users WHERE id=? AND status='active' ON CONFLICT(tag_id,user_id) DO UPDATE SET vote_type=excluded.vote_type",id,b.vote,uid).run();return json({ok:true})}
 if(path.startsWith('/api/admin/')){
  if(user?.role!=='admin')throw new HttpError(403,'ADMIN_REQUIRED','관리자 권한이 필요합니다.');
  if(path==='/api/admin/stats'&&method==='GET')return json(await first(env,`SELECT count(*) total,coalesce(sum(c.deleted_at IS NULL AND c.moderated_at IS NULL AND ${activeAuthor}),0) active,coalesce(sum(c.deleted_at IS NULL AND c.moderated_at IS NOT NULL),0) moderated,coalesce(sum(c.deleted_at IS NOT NULL),0) deleted,coalesce(sum(c.deleted_at IS NULL AND NOT ${activeAuthor}),0) withdrawn FROM comments c`));
  if(path==='/api/admin/comments'&&method==='GET'){
   const status=url.searchParams.get('status')||'all',conditions:Record<string,string>={all:'1',normal:`c.deleted_at IS NULL AND c.moderated_at IS NULL AND ${activeAuthor}`,moderated:'c.deleted_at IS NULL AND c.moderated_at IS NOT NULL',deleted:'c.deleted_at IS NOT NULL',withdrawn:`c.deleted_at IS NULL AND NOT ${activeAuthor}`};if(!(status in conditions))throw new HttpError(400,'INVALID_INPUT','잘못된 상태입니다.');const page=url.searchParams.get('page_id'),where=conditions[status]+(page?' AND c.page_id=?':'');const values=page?[page]:[];
   const data=await all(env,commentSelect+` WHERE ${where} ORDER BY c.id DESC LIMIT ? OFFSET ?`,uid,...values,integer(url.searchParams.get('limit'),20,100)||20,integer(url.searchParams.get('offset'),0,1000000));
   return json({data:data.map(c=>({...c,moderation_reason:c.moderation_reason?JSON.parse(c.moderation_reason):null})),count:(await first(env,`SELECT count(*) count FROM comments c WHERE ${where}`,...values))!.count});
  }
  const moderation=path.match(/^\/api\/admin\/comments\/(\d+)\/moderation$/);if(moderation&&method==='PUT'){
   const b=await body(r);if(typeof b.hidden!=='boolean')throw new HttpError(400,'INVALID_INPUT','숨김 상태가 필요합니다.');const reason=b.hidden?JSON.stringify({category:text(b.category,1,100),detail:typeof b.detail==='string'?text(b.detail||' ',0,1000):''}):null;
   const changed=await first(env,"UPDATE comments SET moderated_at=CASE WHEN ? THEN COALESCE(moderated_at,?) ELSE NULL END,moderation_reason=? WHERE id=? AND deleted_at IS NULL AND (moderated_at IS NULL OR moderated_at>?) AND EXISTS(SELECT 1 FROM users WHERE id=? AND status='active' AND role='admin') RETURNING id",b.hidden?1:0,timestamp(),reason,Number(moderation[1]),moderationCutoff(),uid);if(!changed)throw notFound();return json({ok:true});
  }
 }
 throw notFound();
}
export default {
 async fetch(r:Request,env:Env){try{const response=await route(r,env);const path=new URL(r.url).pathname;
  // Native form POSTs use Origin: null under no-referrer. Only the age form
  // needs same-origin; Google redirects and callbacks must still leak no URL.
  if(path.startsWith('/auth/'))response.headers.set('Referrer-Policy',path==='/auth/google'&&r.method==='GET'&&response.status===200?'same-origin':'no-referrer');
  return response}catch(error){if(error instanceof HttpError)return json({error:{code:error.code,message:error.message}},error.status);if(error instanceof Error&&error.message.includes('UNIQUE constraint'))return json({error:{code:'CONFLICT',message:'이미 사용 중인 값입니다.'}},409);return json({error:{code:'INTERNAL',message:'요청을 처리할 수 없습니다.'}},500)}},
 async scheduled(_event:ScheduledEvent,env:Env){await cleanupAdminAudit(env.DB);await cleanupAnalytics(env.DB);await cleanWithdrawals(env);await purgeAccounts(env.DB);await purgeExpiredComments(env.DB);await env.DB.batch([statement(env,'DELETE FROM sessions WHERE token_hash IN(SELECT token_hash FROM sessions WHERE expires_at<? ORDER BY expires_at LIMIT 1000)',now()),statement(env,'DELETE FROM oauth_states WHERE state_hash IN(SELECT state_hash FROM oauth_states WHERE expires_at<? ORDER BY expires_at LIMIT 1000)',now()),statement(env,'DELETE FROM rate_limits WHERE key IN(SELECT key FROM rate_limits WHERE expires_at<? ORDER BY expires_at LIMIT 1000)',now())])}
};
