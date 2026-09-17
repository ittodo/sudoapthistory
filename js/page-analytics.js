/* Anonymous page loads only: no URL parameters, cookies or persistent visitor IDs. */
(()=>{'use strict';
 if(window.__nodoPageAnalytics)return;window.__nodoPageAnalytics=true;
 const path=location.pathname.replace(/index\.html$/,'');
 if(/^\/(admin|auth|api)(\/|$)/.test(path))return;
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
