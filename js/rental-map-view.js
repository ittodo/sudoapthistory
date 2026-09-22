/* Rental viewport shares the sale map's region boundaries and price cards. */
window.NodoRentalMapView=({settings,refresh,stop,detailURL,esc,money})=>{
 const hash=new URLSearchParams(location.hash.slice(1));let lat=Number(hash.get('lat')),lng=Number(hash.get('lng')),zoom=Number(hash.get('z'));
 if(!(lat>=33&&lat<=40&&lng>=124&&lng<=132&&zoom>=7&&zoom<=19)){lat=37.5;lng=126.98;zoom=10;}
 const map=L.map('rental-map',{preferCanvas:true,zoomControl:false}).setView([lat,lng],zoom);
 L.control.zoom({position:'topright'}).addTo(map);
 L.tileLayer(window.NodoMapServices?.tileURL||'https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:window.NodoMapServices?'© V-World':'© OpenStreetMap'}).addTo(map);
 const host=document.querySelector('.rental-map-workspace'),status=document.createElement('p');status.className='rental-map-status';status.setAttribute('role','status');host.append(status);
 let points=[],summaries=[],regionView,regionFailed=false,selected=null,moveFrame,contextKey;const markers=new Map(),complexes=new Map(),tap=NodoMapModel.bindMapTap(map);
 const price=p=>settings.type==='jeonse'?'전세 '+money(p.deposit):settings.convert?'월 환산 '+money(p.value):money(p.deposit)+' / 월 '+money(p.rent);
 const short=v=>Number(v).toLocaleString('ko-KR',{maximumFractionDigits:1});
 const depositMoney=v=>v==null?'미확인':v>=10000?short(v/10000)+'억':short(v)+'만';
 const average=(v,s)=>v==null?'가격 없음':settings.type==='jeonse'?'평균 '+(v>=10000?short(v/10000)+'억':short(v)+'만'):settings.convert?'월 환산 '+short(v)+'만\n보증금 환산 '+depositMoney(s.depositEquivalentAverage):'보증금 '+depositMoney(s.depositAverage)+'\n월세 '+short(v)+'만';
 function open(p){stop();selected=p;NodoApartmentLinks.open(detailURL(p));draw();}
 function beginView(){
  // Like the sale timeline, retain the last completed frame while the next date loads.
  // Tenure, conversion and filter changes still clear incompatible prices immediately.
  const key=JSON.stringify(Object.fromEntries(Object.entries(settings).filter(([name])=>!['day','bounds','zoom','limit','regionCacheDisabled'].includes(name))));
  if(key===contextKey)return false;
  contextKey=key;selected=null;points=[];summaries=[];map.closePopup();
  regionView?.setSummaries([],settings.region?NodoRental.REGIONS.indexOf(settings.region):null);
  status.textContent=settings.type==='sale'?'':`${settings.type==='monthly'?'월세':'전세'} · ${settings.day} · 자료를 불러오는 중…`;
  draw();return true;
 }
 function draw(){
  host.classList.toggle('rental-rent-pair',settings.type==='monthly');
  regionView?.render();const keep=new Set(),bounds=map.getBounds();
  for(const p of points){
   if(!bounds.contains(p.coord)||(map.getZoom()<16&&regionView&&p.admin.length===3))continue;
   const anchor=NodoMapModel.labelPosition(complexes.get(p.id)||complexes.get(p.publicId)||p,map);
   const key=p.id;keep.add(key);let entry=markers.get(key);
   const html=`<div class="apt-label ${selected?.id===p.id?'selected':''}"><b>${esc(price(p))}</b><small>${esc(p.name)} · ${p.area}㎡</small></div>`;
   if(!entry){const marker=L.marker(anchor,{icon:L.divIcon({className:'apt-marker rental-price-marker',html,iconSize:[140,48],iconAnchor:[70,24]}),title:p.name+' · '+price(p)}).addTo(map);entry={marker,html,point:p};markers.set(key,entry);marker.on('click',()=>open(entry.point));}
   else if(entry.html!==html){entry.marker.getElement().innerHTML=html;entry.html=html;}
   entry.marker.getElement().title=p.name+' · '+price(p);
   entry.marker.setLatLng(anchor);entry.point=p;
  }
  for(const [key,entry]of markers)if(!keep.has(key)){map.removeLayer(entry.marker);markers.delete(key);}
 }
 map.on('moveend',()=>{
  const c=map.getCenter(),p=new URLSearchParams(location.hash.slice(1));p.set('lat',c.lat.toFixed(5));p.set('lng',c.lng.toFixed(5));p.set('z',map.getZoom());history.replaceState(null,'','#'+p);
  draw();cancelAnimationFrame(moveFrame);moveFrame=requestAnimationFrame(refresh);
 });
 // Boundaries are independent of rental history; load them without blocking prices.
 fetch('/data/map/index.json').then(r=>{if(!r.ok)throw Error('경계 자료 오류');return r.json();}).then(payload=>{
  for(const c of payload.d){complexes.set(c.id,c);if(c.publicationId&&!complexes.has(c.publicationId))complexes.set(c.publicationId,c);}
  regionView=NodoMapRegions.create({map,payload,client:createVerifiedDataClient('/',payload.meta.sources),tap,formatAverage:average,summaryBasis:'최신 대표 계약값 산술평균',navigate:r=>map.fitBounds(r.bounds,{padding:[40,40],maxZoom:16}),report:s=>{regionFailed=s==='error';status.title=regionFailed?'행정 경계 일부를 불러오지 못했습니다.':'';}});
  regionView.setSummaries(summaries,settings.region?NodoRental.REGIONS.indexOf(settings.region):null);draw();
 }).catch(()=>{regionFailed=true;settings.regionCacheDisabled=true;status.title='행정 경계 없이 단지 가격을 표시합니다.';draw();refresh();});
 new ResizeObserver(()=>map.invalidateSize()).observe(host);
 return {map,beginView,redraw:draw,setData(next,totals=[]){beginView();points=next;summaries=totals;regionView?.setSummaries(totals,settings.region?NodoRental.REGIONS.indexOf(settings.region):null);status.textContent=map.getZoom()<16&&totals.length?`지역별 평균 · ${settings.day} · 확대하면 단지별 가격 표시`:`현재 영역 ${points.length.toLocaleString()}개 단지 · ${settings.day} · 단지를 누르면 상세`;draw();}};
};
