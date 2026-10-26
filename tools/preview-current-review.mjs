// Read-only candidate overlay. This server never runs the production Worker.
import {createServer} from 'node:http';
import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {resolve,join,dirname,parse,relative,isAbsolute,sep,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {publicAsset} from './build-cloudflare-assets.mjs';

const sourceRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png',
  '.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.ico':'image/x-icon',
  '.woff':'font/woff','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8','.xml':'application/xml; charset=utf-8'};
const banner='<aside id="current-review-preview" role="note" aria-label="미리보기 상태">현재 리뷰 데이터 미리보기 · 운영 미반영</aside>';
const bannerStyle='<style>#current-review-preview{position:fixed;z-index:10000;right:12px;bottom:12px;max-width:calc(100vw - 24px);box-sizing:border-box;padding:7px 12px;border:1px solid #73968c;border-radius:999px;background:#193c34;color:#fff;font:500 12px/1.4 system-ui,sans-serif;box-shadow:0 2px 10px #0002;pointer-events:none}</style>';
const inside=(root,path)=>{const r=relative(root,path);return r!==''&&!r.startsWith('..'+sep)&&r!=='..'&&!isAbsolute(r);};
const same=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
function checkedRoot(value){
  const root=resolve(value);let path=parse(root).root;
  for(const part of relative(path,root).split(sep).filter(Boolean)){
    path=join(path,part);
    if(lstatSync(path).isSymbolicLink())throw Error('Preview root cannot use a symbolic link or junction');
  }
  if(!lstatSync(root).isDirectory()||!same(root,realpathSync(root)))throw Error('Invalid preview root');
  return root;
}
function fileAt(root,name){
  let path=root;
  for(const part of name.split('/')){
    path=join(path,part);let stat;
    try{stat=lstatSync(path);}catch(error){if(error.code==='ENOENT'||error.code==='ENOTDIR')return null;throw error;}
    if(stat.isSymbolicLink())throw Error('Linked preview asset');
  }
  if(!inside(root,realpathSync(path)))throw Error('Preview asset escapes root');
  return lstatSync(path).isFile()?path:null;
}
function requestPath(url){
  if(typeof url!=='string'||!url.startsWith('/')||url.startsWith('//'))throw Error('Invalid request path');
  const raw=url.split('?')[0];let path;
  try{path=decodeURIComponent(raw);}catch{throw Error('Invalid path encoding');}
  if(/[\\:%#\x00-\x1f\x7f]/.test(path))throw Error('Invalid request path');
  const parts=path.slice(1).split('/');if(parts.at(-1)==='')parts.pop();
  if(parts.some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p)||/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(p)))throw Error('Invalid request path');
  return parts.join('/')+(path.endsWith('/')&&parts.length?'/':'');
}
function allowed(name){
  return publicAsset(name)&&!name.split('/').some(p=>/^(evidence|private|_ops)$/i.test(p))&&!/(^|\/)manifest\.json$/i.test(name);
}
const derivedData=name=>/^data\/(?:search|map\/(?:price-cache|boundaries)|rental\/(?:map-cache|market-cache))\//.test(name);

export function createCurrentReviewPreview({baseline=sourceRoot,candidate}={}){
  if(!candidate)throw Error('An explicit candidate directory is required');
  baseline=checkedRoot(baseline);candidate=checkedRoot(candidate);
  if(!candidate.split(sep).some(p=>p==='_ops')||same(baseline,candidate)||inside(baseline,candidate)||inside(candidate,baseline))throw Error('Candidate must be separate and inside an _ops directory');
  const manifestPath=fileAt(candidate,'manifest.json');
  const manifest=manifestPath&&JSON.parse(readFileSync(manifestPath,'utf8'));
  // Formal generation output is also inspectable here. This loopback server
  // never runs release, authentication, or write APIs.
  if(!manifest||(manifest.candidateOnly!==true&&!(manifest.candidateOnly===false&&manifest.contract==='current-review-publication-v1')))throw Error('An explicit candidateOnly manifest or current publication export is required');
  function locate(name){
    if(!allowed(name))return null;
    // Current source controls the UI. Candidate files may override public data only.
    if(name.startsWith('data/')){const overlay=fileAt(candidate,name);if(overlay)return overlay;}
    // Old search and map caches embed old group metadata. A candidate must supply
    // its own derived caches; a missing cache lets map clients use shared facts.
    if(derivedData(name))return null;
    const original=fileAt(baseline,name);if(original)return original;
    if(name==='js/apartment-search-worker.bundle.js'){
      // Check each dist parent too; do not follow a linked build directory.
      return fileAt(baseline,'cloudflare/dist/public/'+name);
    }
    return null;
  }
  const server=createServer((req,res)=>{
    const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow',
      'Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'same-origin',
      'Content-Security-Policy':"frame-ancestors 'self'; form-action 'none'; base-uri 'self'; object-src 'none'"};
    const send=(status,body='',extra={})=>{
      const bytes=Buffer.isBuffer(body)?body:Buffer.from(body);
      res.writeHead(status,{...headers,'Content-Type':'text/plain; charset=utf-8','Content-Length':bytes.length,...extra});
      res.end(req.method==='HEAD'?undefined:bytes);
    };
    try{
      const host=req.headers.host||'',port=server.address()?.port;
      if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(host))return send(403,'Local preview only');
      if(!['GET','HEAD'].includes(req.method))return send(405,'Read-only preview',{Allow:'GET, HEAD'});
      let name;
      try{name=requestPath(req.url);}catch{return send(400,'Invalid request path');}
      if(/^(?:api|auth|__preview)(?:\/|$)/i.test(name))return send(404,'Not available in this preview');
      if(!name||name.endsWith('/'))name+='index.html';
      let path=locate(name);
      if(!path&&!extname(name)){
        path=locate(name+'/index.html');
        if(path){
          const query=req.url.includes('?')?'?'+req.url.split('?').slice(1).join('?'):'';
          return send(308,'',{Location:'/'+name+'/'+query});
        }
        name+='.html';path=locate(name);
      }
      if(!path)return send(404,'Not found');
      let bytes=readFileSync(path);
      if(extname(name)==='.html'){
        let html=bytes.toString('utf8');
        html=/<\/head\s*>/i.test(html)?html.replace(/<\/head\s*>/i,bannerStyle+'</head>'):bannerStyle+html;
        html=/<body(?:\s[^>]*)?>/i.test(html)?html.replace(/<body(?:\s[^>]*)?>/i,match=>match+banner):html+banner;
        bytes=Buffer.from(html);
      }
      send(200,bytes,{'Content-Type':mime[extname(name)]||'application/octet-stream'});
    }catch{
      // Do not expose local paths or internal parser errors through HTTP.
      send(404,'Not found');
    }
  });
  server.on('clientError',(_error,socket)=>socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'));
  return server;
}

export function startCurrentReviewPreview({port=8794,...options}={}){
  if(!Number.isSafeInteger(port)||port<0||port>65535)throw Error('Invalid preview port');
  const server=createCurrentReviewPreview(options);
  return new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(port,'127.0.0.1',()=>{server.off('error',reject);resolve(server);});
  });
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const args=process.argv.slice(2),options={candidate:args.shift()};
    if(!options.candidate||options.candidate.startsWith('--'))throw Error('Usage: node preview-current-review.mjs CANDIDATE [--baseline DIRECTORY] [--port 8794]');
    while(args.length){
      const flag=args.shift(),value=args.shift();
      if(!value||!['--baseline','--port'].includes(flag))throw Error('Invalid preview option');
      options[flag.slice(2)]=flag==='--port'?Number(value):value;
    }
    const server=await startCurrentReviewPreview(options);
    console.log('Current review preview: http://127.0.0.1:'+server.address().port+'/map/ (read-only; not published)');
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close(()=>process.exit(0)));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
