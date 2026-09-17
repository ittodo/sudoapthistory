import {Env,HttpError,body,json,now} from './shared';

export const pages:Record<string,string>={
 '/':'단지 검색','/map/':'지도','/compare/':'지역·단지 비교','/market/':'시장 동향',
 '/stats/':'가격대 통계','/trades/':'실거래가','/trades/contracts.html':'계약 현황',
 '/apartment/':'단지 상세','/ranking/':'관심 단지 순위','/library/':'내 보관함',
 '/calc/':'부동산 계산기','/calc/savings.html':'예적금 계산기','/div/':'배당·소각',
 '/div/stocks/':'기업 목록','/div/stocks/detail.html':'기업 상세','/board/':'게시판',
 '/account/':'내 계정','/policy.html':'정책','/privacy.html':'개인정보처리방침',
 '/kapt-v2.html':'공동주택 정보','/site-tree.html':'사이트 안내','/dart.html':'DART',
 '/prices.html':'가격 조회','/savings.html':'예적금 계산기 (이전 주소)'
};
export function koreanDay(time:number){return new Date(time+9*3600000).toISOString().slice(0,10);}
export function pagePath(value:unknown){
 if(typeof value!=='string'||value.length>200||!value.startsWith('/')||value.startsWith('//')||/[?#\\]/.test(value))return null;
 const path=value.replace(/index\.html$/,'');
 const canonical=Object.hasOwn(pages,path)?path:path+'/';
 return Object.hasOwn(pages,canonical)?canonical:null;
}
export async function collectPageView(r:Request,env:Env){
 if(r.method!=='POST')throw new HttpError(405,'METHOD','지원하지 않는 요청입니다.');
 if(r.headers.get('Origin')!==env.SITE_ORIGIN)throw new HttpError(403,'ORIGIN','허용되지 않은 출처입니다.');
 if(env.MAINTENANCE==='true')return json({ok:false},503);
 const b=await body(r),path=pagePath(b.path),time=now(),sentAt=b.sentAt;
 if(!path||typeof b.eventId!=='string'||! /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(b.eventId)||typeof sentAt!=='number'||!Number.isSafeInteger(sentAt)||sentAt<time-86400||sentAt>time+300)throw new HttpError(400,'INVALID_INPUT','조회 기록을 확인해 주세요.');
 // D1 batch is transactional; changes() gates the counter on the preceding insert.
 await env.DB.batch([
  env.DB.prepare('INSERT OR IGNORE INTO page_events(id,created_at) VALUES(?,?)').bind(b.eventId,time),
  env.DB.prepare('INSERT INTO page_daily(day,path,views) SELECT ?,?,1 WHERE changes()=1 ON CONFLICT(day,path) DO UPDATE SET views=views+1').bind(koreanDay(time*1000),path)
 ]);
 return json({ok:true});
}
export async function cleanupPageViews(db:D1Database,time=now()){
 await db.prepare('DELETE FROM page_events WHERE id IN (SELECT id FROM page_events WHERE created_at<? LIMIT 10000)').bind(time-2*86400).run();
}
export async function pageReport(env:Env,days:number){
 const to=koreanDay(Date.now()),from=koreanDay(Date.now()-(days-1)*86400000);
 const rows=(await env.DB.prepare('SELECT path,sum(views) views FROM page_daily WHERE day>=? AND day<=? GROUP BY path ORDER BY views DESC,path').bind(from,to).all<{path:string;views:number}>()).results;
 return {days,from,to,total:rows.reduce((n,r)=>n+r.views,0),data:rows.map(r=>({...r,name:pages[r.path]||r.path}))};
}
