import {Env,HttpError,body,text,json,now,session,rate,cookie,setCookie,hash} from './shared';
type User=Awaited<ReturnType<typeof session>>;
type Row=Record<string,any>;
const bad=()=>new HttpError(400,'INVALID_INPUT','입력 내용을 확인해 주세요.');
const missing=()=>new HttpError(404,'NOT_FOUND','저장 항목을 찾을 수 없습니다.');
const conflict=()=>new HttpError(409,'CONFLICT','다른 기기에서 변경되었습니다. 다시 불러와 주세요.');
const publicCache=new Map<string,Row>();
async function asset(env:Env,path:string){const key=env.SITE_ORIGIN+'|'+env.RELEASE_SHA+'|'+path;if(publicCache.has(key))return publicCache.get(key)!;const r=await env.ASSETS.fetch(new Request(env.SITE_ORIGIN+path));if(!r.ok)throw new HttpError(503,'DATA_UNAVAILABLE','단지 자료를 불러오지 못했습니다.');const data=await r.json() as Row;if(publicCache.size>=16)publicCache.delete(publicCache.keys().next().value!);publicCache.set(key,data);return data;}
export async function cleanupAnalytics(db:D1Database,time=now()){await db.prepare('DELETE FROM apartment_events WHERE created_at<?').bind(time-30*86400).run();}
async function apartment(env:Env,id:string){const catalog=await asset(env,'/data/apartments/index.json'),ref=catalog.lookup[id];if(!ref)throw missing();const data=await asset(env,'/data/apartments/summary/'+ref[1]+'.json');const a=data[ref[0]];if(!a)throw missing();return a as Row;}
export async function libraryRoute(r:Request,env:Env,user:User):Promise<Response|null>{
 const url=new URL(r.url),path=url.pathname,method=r.method,db=env.DB;
 const all=async(sql:string,...args:any[])=>(await db.prepare(sql).bind(...args).all<Row>()).results;
 if(path==='/api/apartments/hearts'&&method==='GET'){
  const ids=(url.searchParams.get('ids')||'').split(',').filter(Boolean);if(!ids.length||ids.length>100||ids.some(id=>id.length>100))throw bad();
  const rows=await all(`SELECT f.apartment_id,count(*) count FROM apartment_favorites f JOIN users u ON u.id=f.user_id AND u.status='active' WHERE f.apartment_id IN (${ids.map(()=>'?').join(',')}) GROUP BY f.apartment_id`,...ids);return json({data:Object.fromEntries(ids.map(id=>[id,Number(rows.find(x=>x.apartment_id===id)?.count||0)]))});
 }
 if(path==='/api/apartments/ranking'&&method==='GET'){
  const region=url.searchParams.get('region')||'',district=url.searchParams.get('district')||'',offset=Math.max(0,Math.min(100000,Number(url.searchParams.get('offset'))||0));
  const rows=await all(`WITH ranked AS (SELECT f.apartment_id,max(f.name) name,max(f.region) region,max(f.district) district,count(*) hearts FROM apartment_favorites f JOIN users u ON u.id=f.user_id AND u.status='active' WHERE (?='' OR f.region=?) AND (?='' OR f.district=?) GROUP BY f.apartment_id) SELECT *,rank() OVER(ORDER BY hearts DESC) rank FROM ranked ORDER BY hearts DESC,apartment_id LIMIT 50 OFFSET ?`,region,region,district,district,offset);
  const districts=await all("SELECT DISTINCT district FROM apartment_favorites WHERE (?='' OR region=?) ORDER BY district",region,region);return json({data:rows,districts:districts.map(x=>x.district)});
 }
 if(!path.startsWith('/api/me/')&&path!=='/api/admin/apartment-analytics')return null;
 if(!user)throw new HttpError(401,'AUTH_REQUIRED','로그인이 필요합니다.');const uid=user.id;
 if(path==='/api/admin/apartment-analytics'&&method==='GET'){
  if(user.role!=='admin')throw new HttpError(403,'FORBIDDEN','관리자만 확인할 수 있습니다.');const days=[1,7,30].includes(Number(url.searchParams.get('days')))?Number(url.searchParams.get('days')):7;
  const from=new Date(Date.now()+9*3600000-(days-1)*86400000).toISOString().slice(0,10);
  return json({data:await all('SELECT apartment_id,sum(views) views,sum(sessions) sessions,sum(hearts) hearts,sum(trades) trades,sum(calculators) calculators FROM apartment_daily WHERE day>=? GROUP BY apartment_id ORDER BY views DESC,apartment_id LIMIT 100',from),sources:await all('SELECT source,sum(views) views FROM apartment_daily WHERE day>=? GROUP BY source',from),from});
 }
 if(path==='/api/me/favorites'&&method==='GET')return json({data:await all("SELECT f.*,COALESCE((SELECT json_group_array(area) FROM favorite_areas a WHERE a.user_id=f.user_id AND a.apartment_id=f.apartment_id),'[]') areas FROM apartment_favorites f WHERE f.user_id=? ORDER BY created_at DESC,apartment_id",uid)});
 const fav=path.match(/^\/api\/me\/favorites\/([^/]+)$/);
 if(fav&&['PUT','DELETE'].includes(method)){
  const id=decodeURIComponent(fav[1]),before=await db.prepare('SELECT version FROM apartment_favorites WHERE user_id=? AND apartment_id=?').bind(uid,id).first<Row>();const b=await body(r);
  if(before&&b.version!==before.version)throw conflict();
  if(method==='DELETE'){if(before)await db.prepare('DELETE FROM apartment_favorites WHERE user_id=? AND apartment_id=? AND version=?').bind(uid,id,b.version).run();return json({ok:true});}
  const a=await apartment(env,id);if(a.id!==id)throw bad();
  if(!Array.isArray(b.areas)||b.areas.length>50||b.areas.some(x=>!a.areas.some((v:Row)=>String(v.area)===x)))throw bad();
  if(!before&&b.version!==0)throw conflict();
  const count=await db.prepare('SELECT count(*) n FROM apartment_favorites WHERE user_id=?').bind(uid).first<Row>();if(!before&&count!.n>=200)throw new HttpError(409,'LIMIT','관심 단지는 200개까지 저장할 수 있습니다.');
  const version=(before?.version||0)+1,mutation=crypto.randomUUID();
  const result=await db.batch([
   db.prepare(`INSERT INTO apartment_favorites(user_id,apartment_id,name,region,district,created_at,version,mutation_id) SELECT ?,?,?,?,?,?,1,? WHERE (SELECT count(*) FROM apartment_favorites WHERE user_id=?)<200 OR EXISTS(SELECT 1 FROM apartment_favorites WHERE user_id=? AND apartment_id=?) ON CONFLICT(user_id,apartment_id) DO UPDATE SET version=version+1,mutation_id=excluded.mutation_id WHERE version=? RETURNING version`).bind(uid,id,a.name,a.region,a.district,now(),mutation,uid,uid,id,b.version),
   db.prepare('DELETE FROM favorite_areas WHERE user_id=? AND apartment_id=? AND EXISTS(SELECT 1 FROM apartment_favorites WHERE user_id=? AND apartment_id=? AND mutation_id=?)').bind(uid,id,uid,id,mutation),
   ...[...new Set(b.areas as string[])].map(v=>db.prepare('INSERT OR IGNORE INTO favorite_areas(user_id,apartment_id,area) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM apartment_favorites WHERE user_id=? AND apartment_id=? AND mutation_id=?)').bind(uid,id,v,uid,id,mutation))
  ]);if(!result[0].results.length)throw conflict();return json({ok:true,version});
 }
 if(path==='/api/me/calculations'&&method==='GET')return json({data:await all('SELECT * FROM saved_calculations WHERE user_id=? ORDER BY updated_at DESC,id',uid)});
 const calc=path.match(/^\/api\/me\/calculations\/([\w-]{1,100})$/);
 if(calc&&['PUT','DELETE'].includes(method)){
  const b=await body(r),id=calc[1],before=await db.prepare('SELECT * FROM saved_calculations WHERE id=? AND user_id=?').bind(id,uid).first<Row>();
  if(before&&b.version!==before.version){if(method==='PUT'&&before.payload===JSON.stringify(b.payload)&&before.name===b.name)return json({ok:true,version:before.version});throw conflict();}if(!before&&b.version!==0)throw missing();
  if(method==='DELETE'){await db.prepare('DELETE FROM saved_calculations WHERE id=? AND user_id=? AND version=?').bind(id,uid,b.version).run();return json({ok:true});}
  const kind=text(b.kind,1,40);if(!['loan','prepay','j2w','w2j','rentcompare','opportunity','savings','deposit'].includes(kind))throw bad();
  const name=text(b.name,1,80),slot=b.slot==='recent'?'recent':null,p=b.payload as Row;
  if(!p||p.schema!==1||p.formula!==1||!p.inputs||typeof p.inputs!=='object'||Array.isArray(p.inputs)||typeof p.result!=='string'||p.result.length>7000||!Number.isFinite(p.calculatedAt))throw bad();
  if(Object.entries(p.inputs).some(([k,v])=>!/^[a-z][\w-]{0,50}$/.test(k)||typeof v!=='string'||v.length>100))throw bad();
  if(slot&&id!==`recent-${uid}-${kind}`)throw bad();
  const result=await db.prepare(`INSERT INTO saved_calculations(id,user_id,kind,slot,name,payload,created_at,updated_at) SELECT ?,?,?,?,?,?,?,? WHERE ? IS NOT NULL OR (SELECT count(*) FROM saved_calculations WHERE user_id=? AND slot IS NULL)<200 OR EXISTS(SELECT 1 FROM saved_calculations WHERE id=? AND user_id=?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,payload=excluded.payload,updated_at=excluded.updated_at,version=saved_calculations.version+1 WHERE saved_calculations.user_id=? AND saved_calculations.version=? AND saved_calculations.kind=excluded.kind AND saved_calculations.slot IS excluded.slot RETURNING version`).bind(id,uid,kind,slot,name,JSON.stringify(p),now(),now(),slot,uid,id,uid,uid,b.version).first();if(!result)throw conflict();return json({ok:true,...result});
 }
 if(path==='/api/me/activity'&&method==='GET'){
  const type=url.searchParams.get('type')||'posts',offset=Math.max(0,Number(url.searchParams.get('offset'))||0);if(!['posts','comments','replies'].includes(type))throw bad();
  const condition=type==='replies'?"c.user_id<>? AND EXISTS(SELECT 1 FROM comments mine WHERE mine.id=c.parent_id AND mine.user_id=?)":`c.user_id=? AND ${type==='posts'?"c.page_id='community' AND c.parent_id IS NULL":"(c.page_id<>'community' OR c.parent_id IS NOT NULL)"}`;
  const data=await all(`SELECT c.id,c.page_id,c.parent_id,c.content,c.created_at FROM comments c JOIN users u ON u.id=c.user_id AND u.status='active' WHERE ${condition} AND c.deleted_at IS NULL AND c.moderated_at IS NULL AND (c.parent_id IS NULL OR EXISTS(SELECT 1 FROM comments p WHERE p.id=c.parent_id AND p.moderated_at IS NULL)) ORDER BY c.created_at DESC,c.id DESC LIMIT 30 OFFSET ?`,uid,...(type==='replies'?[uid]:[]),offset);return json({data});
 }
 return null;
}
export async function collectEvent(r:Request,env:Env){
 if(r.method!=='POST')throw new HttpError(405,'METHOD','지원하지 않는 요청입니다.');if(r.headers.get('Origin')!==env.SITE_ORIGIN)throw new HttpError(403,'ORIGIN','허용되지 않은 출처입니다.');
 if(env.MAINTENANCE==='true')return json({ok:false},503);
 const b=await body(r),id=text(b.apartmentId,1,100),area=text(b.area||'none',1,30),kind=text(b.kind,1,20);if(!['view','heart','trades','calculator'].includes(kind))throw bad();
 const a=await apartment(env,id);if(a.id!==id||area!=='none'&&!a.areas.some((x:Row)=>String(x.area)===area))throw bad();
 let source=['search','map','favorites','ranking','internal','direct'].includes(String(b.source))?String(b.source):'direct';
 let visit=cookie(r,'__Host-nodo_visit');if(!/^[a-f0-9-]{36}$/.test(visit))visit=crypto.randomUUID();const visitHash=await hash(visit);await rate(env.DB,'analytics:'+visitHash,120,3600);
 const time=now(),day=new Date(time*1000+9*3600000).toISOString().slice(0,10);
 const initial=await env.DB.prepare("SELECT source FROM apartment_events WHERE visit=? AND apartment_id=? AND day=? AND kind='view' ORDER BY created_at LIMIT 1").bind(visitHash,id,day).first<Row>();if(initial)source=initial.source;if(kind!=='view'&&!initial)return json({ok:true});
 await env.DB.batch([
  env.DB.prepare('INSERT OR IGNORE INTO apartment_events(id,visit,apartment_id,area,kind,source,day,created_at,bucket) SELECT ?,?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM apartment_events WHERE visit=? AND apartment_id=? AND area=? AND kind=? AND created_at>?)').bind(crypto.randomUUID(),visitHash,id,area,kind,source,day,time,Math.floor(time/1800),visitHash,id,area,kind,time-1800),
  env.DB.prepare(`INSERT INTO apartment_daily(day,apartment_id,source,views,sessions,hearts,trades,calculators) SELECT day,apartment_id,source,sum(kind='view'),count(DISTINCT CASE WHEN kind='view' THEN visit END),count(DISTINCT CASE WHEN kind='heart' THEN visit END),count(DISTINCT CASE WHEN kind='trades' THEN visit END),count(DISTINCT CASE WHEN kind='calculator' THEN visit END) FROM apartment_events WHERE day=? AND apartment_id=? GROUP BY day,apartment_id,source ON CONFLICT(day,apartment_id,source) DO UPDATE SET views=excluded.views,sessions=excluded.sessions,hearts=excluded.hearts,trades=excluded.trades,calculators=excluded.calculators`).bind(day,id)
 ]);
 const result=json({ok:true});result.headers.append('Set-Cookie',setCookie('__Host-nodo_visit',visit,1800));return result;
}
