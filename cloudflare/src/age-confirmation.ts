import {Env,HttpError,cookie,hash,setCookie,token} from './shared';
export const AGE_NONCE_PREFIX='age14-v1:';
const name='__Host-nodo_age';
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

// A self-declaration, not verified age. Do not collect birth dates or request Google age scopes.
export async function ageConfirmation(r:Request,env:Env):Promise<Response|null>{
 if(r.method==='GET'){
  const raw=token(),csrf=await hash('age14:'+raw);
  const returnTo=new URL(r.url).searchParams.get('returnTo')||'/';
  const action='/auth/google?'+new URLSearchParams({returnTo});
  return new Response(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>가입·로그인 전 확인 · nodostream.com</title><style>body{margin:0;background:#0f172a;color:#e2e8f0;font:16px/1.7 system-ui}main{max-width:520px;margin:8vh auto;padding:28px}label{display:block;padding:18px 0}input{width:20px;height:20px;vertical-align:middle}button{padding:12px 18px;font:inherit;background:#2563eb;color:white;border:0;border-radius:8px}a{color:#93c5fd}p{color:#cbd5e1}</style><main><h1>가입·로그인 전 확인</h1><p>회원 가입은 만 14세 이상만 가능합니다. 처음 로그인하면 새 회원으로 가입됩니다.</p><form method="post" action="${escape(action)}"><input type="hidden" name="csrf" value="${csrf}"><label><input type="checkbox" name="age14" value="yes" required> [필수] 만 14세 이상입니다.</label><p>이 확인은 이용자의 자기신고이며 실제 나이를 인증하는 절차는 아닙니다. 생년월일은 수집하지 않습니다.</p><button type="submit">확인하고 Google로 계속</button></form><p><a href="/">취소하고 홈으로</a></p></main></html>`,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://accounts.google.com; frame-ancestors 'none'; base-uri 'none'",'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Set-Cookie':setCookie(name,raw,600)}});
 }
 if(r.method!=='POST')throw new HttpError(405,'METHOD','지원하지 않는 요청입니다.');
 if(r.headers.get('Origin')!==env.SITE_ORIGIN)throw new HttpError(403,'ORIGIN','허용되지 않은 출처입니다.');
 if(!r.headers.get('Content-Type')?.startsWith('application/x-www-form-urlencoded'))throw new HttpError(415,'CONTENT_TYPE','연령 확인 화면을 이용해 주세요.');
 const reader=r.body?.getReader();let size=0;const chunks:Uint8Array[]=[];
 if(reader)while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>16384){await reader.cancel();throw new HttpError(413,'BODY_TOO_LARGE','요청이 너무 큽니다.');}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 const form=new URLSearchParams(new TextDecoder().decode(bytes)),raw=cookie(r,name);
 if(!raw||form.get('csrf')!==await hash('age14:'+raw))throw new HttpError(403,'CSRF','연령 확인 화면을 다시 열어 주세요.');
 if(form.getAll('age14').length!==1||form.get('age14')!=='yes')throw new HttpError(400,'AGE_CONFIRMATION_REQUIRED','만 14세 이상임을 확인해야 가입·로그인할 수 있습니다.');
 return null;
}
export const clearAgeCookie=()=>setCookie(name,'',0);
