export interface Env { DB:D1Database; ASSETS:Fetcher; SITE_ORIGIN:string; GOOGLE_CLIENT_ID:string; GOOGLE_CLIENT_SECRET:string; RELEASE_SHA:string; MAINTENANCE:string; AUTH_ENABLED:string; WITHDRAWAL_ENABLED?:string; WITHDRAWAL_ENCRYPTION_KEY?:string; CF_VERSION_METADATA?:{id:string} }
export class HttpError extends Error { constructor(public status:number, public code:string, message:string){super(message)} }
export const now=()=>Math.floor(Date.now()/1000);
export const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(x=>x.toString(16).padStart(2,'0')).join('');
export const token=()=>crypto.randomUUID()+crypto.randomUUID();
export const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
export const cookie=(r:Request,name:string)=>r.headers.get('Cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1) || '';
export const setCookie=(name:string,value:string,age:number)=>`${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
export async function body(r:Request):Promise<Record<string,unknown>> {
 if(!r.headers.get('content-type')?.startsWith('application/json'))throw new HttpError(415,'CONTENT_TYPE','JSON 요청이 필요합니다.');
 const reader=r.body?.getReader();let size=0;const chunks:Uint8Array[]=[];
 if(reader)while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>16384){await reader.cancel();throw new HttpError(413,'BODY_TOO_LARGE','요청이 너무 큽니다.')}chunks.push(value)}
 const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length}
 try{const b=JSON.parse(new TextDecoder().decode(bytes));if(!b||typeof b!=='object'||Array.isArray(b))throw 0;return b}catch{throw new HttpError(400,'INVALID_JSON','잘못된 JSON입니다.')}
}
export function text(value:unknown,min:number,max:number):string {if(typeof value!=='string'||value.trim().length<min||value.trim().length>max)throw new HttpError(400,'INVALID_INPUT','입력 길이를 확인해 주세요.');return value.trim()}
export async function rate(db:D1Database,key:string,limit:number,seconds:number){const time=now(),bucket=Math.floor(time/seconds);const row=await db.prepare('INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 WHERE count<? RETURNING count').bind(`${key}:${bucket}`,time+seconds,limit).first();if(!row)throw new HttpError(429,'RATE_LIMIT','잠시 후 다시 시도해 주세요.')}
export async function session(r:Request,env:Env){const raw=cookie(r,'__Host-nodo_session');if(!raw)return null;const value=await env.DB.prepare("SELECT u.id,u.email,u.role,s.authenticated_at,s.reauthenticated_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=? AND expires_at>? AND u.status='active'").bind(await hash(raw),now()).first<{id:string,email:string,role:string,authenticated_at:number,reauthenticated_at:number|null}>();return value?{...value,csrfToken:await hash('csrf:'+raw)}:null}
