// Static Assets currently ignores Range. Limit this adapter to annual map states.
export async function stateAsset(request:Request,assets:Fetcher):Promise<Response>{
 const match=request.method==='GET'&&request.headers.get('Range')?.match(/^bytes=(\d+)-(\d+)$/);
 if(!match)return assets.fetch(request);
 const source=new Request(request),headers=source.headers;
 headers.delete('Range');headers.delete('If-Range');headers.set('Accept-Encoding','identity');
 const response=await assets.fetch(source);
 if(response.status!==200||!response.body||response.headers.has('Content-Encoding'))return response;
 const condition=request.headers.get('If-Range');
 if(condition&&condition!==response.headers.get('ETag')&&condition!==response.headers.get('Last-Modified'))return response;
 const total=Number(response.headers.get('Content-Length')),start=Number(match[1]),requestedEnd=Number(match[2]);
 if(!Number.isSafeInteger(total)||total<=0)return response;
 const out=new Headers(response.headers);out.set('Accept-Ranges','bytes');
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(requestedEnd)||start>requestedEnd||start>=total){await response.body.cancel();out.set('Content-Range',`bytes */${total}`);out.set('Content-Length','0');return new Response(null,{status:416,headers:out});}
 const end=Math.min(requestedEnd,total-1),reader=response.body.getReader();let position=0;
 const body=new ReadableStream<Uint8Array>({async pull(controller){
  try{for(;;){const {value,done}=await reader.read();if(done){controller.error(new Error('Incomplete state asset'));return;}
   const from=Math.max(0,start-position),to=Math.min(value.byteLength,end+1-position);position+=value.byteLength;
   if(to>from)controller.enqueue(value.subarray(from,to));
   if(position>end){controller.close();await reader.cancel();return;}if(to>from)return;
  }}catch(error){controller.error(error);}
 },cancel(reason){return reader.cancel(reason);}});
 out.set('Content-Range',`bytes ${start}-${end}/${total}`);out.set('Content-Length',String(end-start+1));
 return new Response(body,{status:206,headers:out});
}
