import * as oauth from 'oauth4webapi';
import {Env,HttpError,hash,token,now,cookie,setCookie,rate,session} from './shared';
const server:oauth.AuthorizationServer={issuer:'https://accounts.google.com',authorization_endpoint:'https://accounts.google.com/o/oauth2/v2/auth',token_endpoint:'https://oauth2.googleapis.com/token',jwks_uri:'https://www.googleapis.com/oauth2/v3/certs',id_token_signing_alg_values_supported:['RS256']};
export async function auth(r:Request,env:Env){
 const url=new URL(r.url);if(r.method!=='GET')throw new HttpError(405,'METHOD','지원하지 않는 요청입니다.');
 if(env.AUTH_ENABLED!=='true'||!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET)throw new HttpError(503,'AUTH_UNCONFIGURED','로그인 준비 중입니다.');
 const client:oauth.Client={client_id:env.GOOGLE_CLIENT_ID,id_token_signed_response_alg:'RS256'};
 if(url.pathname==='/auth/google'){
  await rate(env.DB,'oauth:'+await hash(r.headers.get('CF-Connecting-IP')||'local'),20,60);
  const state=oauth.generateRandomState(),nonce=oauth.generateRandomNonce(),verifier=oauth.generateRandomCodeVerifier();
  let returnTo=url.searchParams.get('returnTo')||'/';if(!returnTo.startsWith('/')||returnTo.startsWith('//')||returnTo.includes('\\'))returnTo='/';
  const reauth=url.searchParams.get('reauth')==='1';const current=reauth?await session(r,env):null;if(reauth&&!current)throw new HttpError(401,'AUTH_REQUIRED','로그인이 필요합니다.');
  await env.DB.prepare('INSERT INTO oauth_states(state_hash,verifier,nonce,return_to,expires_at,reauth_user,session_hash) VALUES(?,?,?,?,?,?,?)').bind(await hash(state),verifier,nonce,returnTo,now()+600,current?.id??null,current?await hash(cookie(r,'__Host-nodo_session')):null).run();
  const destination=new URL(server.authorization_endpoint!);destination.search=new URLSearchParams({client_id:client.client_id,redirect_uri:env.SITE_ORIGIN+'/auth/callback',response_type:'code',scope:'openid email profile',state,nonce,code_challenge:await oauth.calculatePKCECodeChallenge(verifier),code_challenge_method:'S256',...(reauth?{prompt:'select_account'}:{})}).toString();
  return new Response(null,{status:302,headers:{Location:destination.href,'Set-Cookie':setCookie('__Host-nodo_oauth',state,600),'Cache-Control':'no-store'}});
 }
 if(url.pathname!=='/auth/callback')throw new HttpError(404,'NOT_FOUND','찾을 수 없습니다.');
 const state=cookie(r,'__Host-nodo_oauth');if(!state||url.searchParams.get('state')!==state)throw new HttpError(400,'OAUTH_STATE','로그인을 다시 시작해 주세요.');
 const stored=await env.DB.prepare('DELETE FROM oauth_states WHERE state_hash=? AND expires_at>? RETURNING verifier,nonce,return_to,reauth_user,session_hash').bind(await hash(state),now()).first<{verifier:string,nonce:string,return_to:string,reauth_user:string|null,session_hash:string|null}>();
 if(!stored)throw new HttpError(400,'OAUTH_STATE','로그인이 만료되었습니다.');
 try {
  const params=oauth.validateAuthResponse(server,client,url,state);
  const response=await oauth.authorizationCodeGrantRequest(server,client,oauth.ClientSecretPost(env.GOOGLE_CLIENT_SECRET),params,env.SITE_ORIGIN+'/auth/callback',stored.verifier);
  const result=await oauth.processAuthorizationCodeResponse(server,client,response,{expectedNonce:stored.nonce,requireIdToken:true});
  await oauth.validateApplicationLevelSignature(server,response);
  const claims=oauth.getValidatedIdTokenClaims(result)!;
  if(typeof claims.sub!=='string'||typeof claims.email!=='string'||claims.email_verified!==true)throw new Error('identity');
  if(stored.reauth_user){
   const raw=cookie(r,'__Host-nodo_session');const current=await session(r,env);
   if(!current||current.id!==stored.reauth_user||await hash(raw)!==stored.session_hash)throw new Error('reauth-session');
   const identity=await env.DB.prepare('SELECT google_sub FROM users WHERE id=?').bind(current.id).first<{google_sub:string}>();if(identity?.google_sub!==claims.sub)throw new Error('reauth-identity');
   await env.DB.prepare('UPDATE sessions SET reauthenticated_at=? WHERE token_hash=? AND user_id=?').bind(now(),stored.session_hash,current.id).run();
   return new Response(null,{status:302,headers:{Location:env.SITE_ORIGIN+stored.return_to,'Cache-Control':'no-store','Set-Cookie':setCookie('__Host-nodo_oauth','',0)}});
  }
  const id=crypto.randomUUID();const raw=token();const timestamp=now();
  await env.DB.batch([
   env.DB.prepare('INSERT INTO users(id,google_sub,email) VALUES(?,?,?) ON CONFLICT(google_sub) DO UPDATE SET email=excluded.email').bind(id,claims.sub,claims.email),
   env.DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,authenticated_at) SELECT ?,id,?,? FROM users WHERE google_sub=?').bind(await hash(raw),timestamp+604800,timestamp,claims.sub)
  ]);
  const headers=new Headers({Location:env.SITE_ORIGIN+stored.return_to,'Cache-Control':'no-store'});headers.append('Set-Cookie',setCookie('__Host-nodo_session',raw,604800));headers.append('Set-Cookie',setCookie('__Host-nodo_oauth','',0));return new Response(null,{status:302,headers});
 }catch{throw new HttpError(400,'OAUTH_FAILED','구글 로그인을 확인할 수 없습니다. 다시 시도해 주세요.')}
}
