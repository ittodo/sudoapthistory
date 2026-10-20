/* Rental viewport shares the sale map's region and apartment boundaries. */
window.NodoRentalMapView=({settings,refresh,stop,detailURL,esc,money})=>{
 const hash=new URLSearchParams(location.hash.slice(1));let lat=Number(hash.get('lat')),lng=Number(hash.get('lng')),zoom=Number(hash.get('z'));
 if(!(lat>=33&&lat<=40&&lng>=124&&lng<=132&&zoom>=7&&zoom<=19)){lat=37.5;lng=126.98;zoom=10;}
 // SVG paths carry data-map-target for the shared pointer guard.
 const map=L.map('rental-map',{preferCanvas:false,zoomControl:false}).setView([lat,lng],zoom);
 L.control.zoom({position:'topright'}).addTo(map);
 L.tileLayer(window.NodoMapServices?.tileURL||'https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:window.NodoMapServices?'© V-World':'© OpenStreetMap'}).addTo(map);
 const host=document.querySelector('.rental-map-workspace'),status=document.createElement('p');status.className='rental-map-status';status.setAttribute('role','status');host.append(status);
 let points=[],summaries=[],regionView,parcelView,regionFailed=false,parcelState='ready',statusText='',selected=null,moveFrame,contextKey;const markers=new Map(),complexes=new Map(),tap=NodoMapModel.bindMapTap(map);
 const price=p=>settings.type==='jeonse'?'전세 '+money(p.deposit):settings.convert?'월 환산 '+money(p.value):money(p.deposit)+' / 월 '+money(p.rent);
 const short=v=>Number(v).toLocaleString('ko-KR',{maximumFractionDigits:1});
 const depositMoney=v=>v==null?'미확인':v>=10000?short(v/10000)+'억':short(v)+'만';
 const average=(v,s)=>v==null?'가격 없음':settings.type==='jeonse'?'평균 '+(v>=10000?short(v/10000)+'억':short(v)+'만'):settings.convert?'월 환산 '+short(v)+'만\n보증금 환산 '+depositMoney(s.depositEquivalentAverage):'보증금 '+depositMoney(s.depositAverage)+'\n월세 '+short(v)+'만';
 const complexFor=p=>p&&(complexes.get(p.id)||complexes.get(p.publicId));
 function reportStatus(){status.textContent=statusText+(parcelState==='error'?' · 일부 단지 경계 미표시':'');status.title=[regionFailed?'행정 경계 일부를 불러오지 못했습니다.':'',parcelState==='error'?'지도를 이동하면 단지 경계를 다시 불러옵니다.':parcelState==='loading'?'단지 경계를 불러오는 중…':''].filter(Boolean).join(' ');}
 function open(p){stop();selected=p;const c=complexFor(p);NodoApartmentLinks.open(detailURL(c?.publicationId?{...p,publicId:c.publicationId}:p));draw();}
 function boundaryMatches(){
  const matches=new Map();
  for(const p of points){const c=complexFor(p);if(!c)continue;const prior=matches.get(c.id);
   if(!prior||p.date>prior.point.date||p.date===prior.point.date&&String(p.id)<String(prior.point.id))matches.set(c.id,{complex:c,point:p});}
  return [...matches.values()];
 }
 function chooseBoundary(group,point){
  if(group.length===1){open(group[0].point);return;}
  if(!group.length)return;
  const choices=document.createElement('div');choices.className='overlap-list';
  for(const match of group){const button=document.createElement('button');button.type='button';button.textContent=`${match.complex.n} · ${price(match.point)} · ${match.point.area}㎡`;button.onclick=()=>{map.closePopup();open(match.point);};choices.append(button);}
  L.popup().setLatLng(point).setContent(choices).openOn(map);
 }
 function beginView(){
  // Like the sale timeline, retain the last completed frame while the next date loads.
  // Tenure, conversion and filter changes still clear incompatible prices immediately.
  const key=JSON.stringify(Object.fromEntries(Object.entries(settings).filter(([name])=>!['day','bounds','zoom','limit','regionCacheDisabled'].includes(name))));
  if(key===contextKey)return false;
  contextKey=key;selected=null;points=[];summaries=[];map.closePopup();
  regionView?.setSummaries([],settings.region?NodoRental.REGIONS.indexOf(settings.region):null);
  statusText=settings.type==='sale'?'':`${settings.type==='monthly'?'월세':'전세'} · ${settings.day} · 자료를 불러오는 중…`;reportStatus();
  draw();return true;
 }
 function draw(){
  host.classList.toggle('rental-rent-pair',settings.type==='monthly');
  regionView?.render();parcelView?.render(boundaryMatches(),complexFor(selected)||null);const keep=new Set(),bounds=map.getBounds();
  for(const p of points){
   if(!bounds.contains(p.coord)||(map.getZoom()<16&&regionView&&p.admin?.length===3))continue;
   const anchor=NodoMapModel.labelPosition(complexFor(p)||p,map);
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
 window.loadMapIndex().then(payload=>{
  for(const c of payload.d){complexes.set(c.id,c);if(c.publicationId&&!complexes.has(c.publicationId))complexes.set(c.publicationId,c);}
  const aliases=new Map();
  for(const c of payload.d)for(const source of c.memberSources||[]){if(!aliases.has(source.id))aliases.set(source.id,c);else if(aliases.get(source.id)?.id!==c.id)aliases.set(source.id,null);}
  for(const [id,c]of aliases)if(c&&!complexes.has(id))complexes.set(id,c);
  const client=createVerifiedDataClient('/',payload.meta.sources);
  regionView=NodoMapRegions.create({map,payload,client,tap,formatAverage:average,summaryBasis:'최신 대표 계약값 산술평균',navigate:r=>map.fitBounds(r.bounds,{padding:[40,40],maxZoom:16}),report:s=>{regionFailed=s==='error';reportStatus();}});
  parcelView=NodoMapParcels.create({map,client,tap,choose:chooseBoundary,report:s=>{parcelState=s;reportStatus();}});
  regionView.setSummaries(summaries,settings.region?NodoRental.REGIONS.indexOf(settings.region):null);draw();
 }).catch(()=>{regionFailed=true;parcelState='error';settings.regionCacheDisabled=true;reportStatus();draw();refresh();});
 new ResizeObserver(()=>map.invalidateSize()).observe(host);
 return {map,beginView,redraw:draw,setData(next,totals=[]){beginView();points=next;summaries=totals;regionView?.setSummaries(totals,settings.region?NodoRental.REGIONS.indexOf(settings.region):null);statusText=map.getZoom()<16&&totals.length?`지역별 평균 · ${settings.day} · 확대하면 단지별 가격 표시`:`현재 영역 ${points.length.toLocaleString()}개 단지 · ${settings.day} · 단지를 누르면 상세`;reportStatus();draw();}};
};
