/* First-party anonymous page counts, plus GA4 on top-level production pages. */
(()=>{'use strict';
 if(window.__nodoPageAnalytics)return;window.__nodoPageAnalytics=true;
 const path=location.pathname.replace(/index\.html$/,'');
 if(/^\/(admin|auth|api)(\/|$)/.test(path))return;
 // Keep Google loading independent of the existing first-party counter.
 // Embedded apartment panels must not start another GA session/page load.
 if(location.protocol==='https:'&&['nodostream.com','www.nodostream.com'].includes(location.hostname)&&window.top===window){
  try{
   const measurementId='G-4SPGCJTJJP';
   const pageURL=new URL(location.href);pageURL.search='';pageURL.hash='';pageURL.pathname=path;
   const incoming=new URLSearchParams(location.search);
   // Preserve campaign attribution without forwarding calculator/search inputs.
   for(const key of ['utm_source','utm_medium','utm_campaign','utm_id','utm_term','utm_content']){
    if(incoming.has(key))pageURL.searchParams.set(key,incoming.get(key));
   }
   let referrer='';
   try{const url=new URL(document.referrer);if(['https:','http:'].includes(url.protocol))referrer=url.origin+url.pathname;}catch{}
   window.dataLayer=window.dataLayer||[];
   window.gtag=window.gtag||function(){window.dataLayer.push(arguments);};
   window.gtag('js',new Date());
   // config sends the initial page_view. Do not send a second manual event.
   window.gtag('config',measurementId,{
    page_location:pageURL.href,page_referrer:referrer,
    allow_google_signals:false,allow_ad_personalization_signals:false
   });
   const script=document.createElement('script');script.async=true;
   script.src='https://www.googletagmanager.com/gtag/js?id='+measurementId;
   document.head.appendChild(script);
  }catch{} // A blocked Google tag must not interrupt the site or local counts.
 }
 function record(){
  try{
   const payload=JSON.stringify({path,eventId:crypto.randomUUID(),sentAt:Math.floor(Date.now()/1000)});
   const send=()=>fetch('/api/analytics/pageviews',{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},body:payload,keepalive:true});
   send().then(r=>{if(r.status>=500)setTimeout(()=>send().catch(()=>{}),1500);}).catch(()=>{setTimeout(()=>send().catch(()=>{}),1500);});
  }catch{} // Analytics must never block the page.
 }
 record();
 window.addEventListener('pageshow',e=>{if(e.persisted)record();});
})();
