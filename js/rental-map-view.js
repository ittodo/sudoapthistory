/* Rental viewport shares the sale map's region boundaries and price cards. */
window.NodoRentalMapView=({settings,refresh,stop,request,detailURL,esc,money})=>{
 const hash=new URLSearchParams(location.hash.slice(1));let lat=Number(hash.get('lat')),lng=Number(hash.get('lng')),zoom=Number(hash.get('z'));
 if(!(lat>=33&&lat<=40&&lng>=124&&lng<=132&&zoom>=7&&zoom<=19)){lat=37.5;lng=126.98;zoom=10;}
 const map=L.map('rental-map',{preferCanvas:true,zoomControl:false}).setView([lat,lng],zoom);
 L.control.zoom({position:'topright'}).addTo(map);
 L.tileLayer(window.NodoMapServices?.tileURL||'https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:window.NodoMapServices?'© V-World':'© OpenStreetMap'}).addTo(map);
 const host=document.querySelector('.rental-map-workspace'),status=document.createElement('p');status.className='rental-map-status';status.setAttribute('role','status');host.append(status);
 const panel=document.createElement('aside');panel.className='rental-map-detail';panel.hidden=true;panel.setAttribute('aria-label','전월세 단지 상세');host.append(panel);
 let points=[],summaries=[],regionView,regionFailed=false,selection=0,selected=null,moveFrame,contextKey;const markers=new Map(),tap=NodoMapModel.bindMapTap(map);
 const price=p=>settings.type==='jeonse'?'전세 '+money(p.deposit):settings.convert?'월 환산 '+money(p.value):money(p.deposit)+' / 월 '+money(p.rent);
 const short=v=>Number(v).toLocaleString('ko-KR',{maximumFractionDigits:1});
 const average=v=>v==null?'가격 없음':settings.type==='jeonse'?'평균 '+(v>=10000?short(v/10000)+'억':short(v)+'만'):(settings.convert?'환산 평균 ':'월세 평균 ')+short(v)+'만';
 async function open(p){
  stop();selected=p;const token=++selection;panel.hidden=false;
  panel.innerHTML=`<button class="rental-detail-close" type="button" aria-label="단지 상세 닫기">×</button><h2>${esc(p.name)}</h2><p>${esc(price(p))}</p><p>${p.area}㎡ · ${p.date} · ${['구분 미상','신규','갱신'][p.contract]}</p><a href="${esc(detailURL(p))}" data-rental-link>단지 전체 상세 ↗</a><h3>${p.date.slice(0,4)}년 계약 내역</h3><div class="rental-map-history" aria-live="polite">계약 내역을 불러오는 중…</div>`;
  panel.querySelector('button').onclick=()=>{selection++;selected=null;panel.hidden=true;draw();};draw();
  try{
   const result=await request('detail',{settings:{...settings,map:false,compactMap:false,detail:p.publicId||p.id,year:p.date.slice(0,4),q:'',searchIds:null,district:'',region:'',limit:30,sort:'date',panels:{daily:false,districts:false,rank:false,trend:false,histogram:false}}});
   if(token!==selection)return;
   panel.querySelector('.rental-map-history').innerHTML=result.rows?.length?result.rows.map(t=>`<div><time>${esc(t.date)}</time><strong>${esc(settings.type==='jeonse'?money(t.deposit):money(t.deposit)+' / 월 '+money(t.rent))}</strong><small>${t.area}㎡ · ${t.floor??'미상'}층 · ${['구분 미상','신규','갱신'][t.contract]}</small></div>`).join(''):'선택 조건의 계약 내역이 없습니다.';
  }catch(e){if(token===selection)panel.querySelector('.rental-map-history').textContent=e.message;}
 }
 function draw(){
  regionView?.render();const keep=new Set(),bounds=map.getBounds();
  for(const p of points){
   if(!bounds.contains(p.coord)||(map.getZoom()<16&&regionView&&p.admin.length===3))continue;
   const key=p.id;keep.add(key);let entry=markers.get(key);
   const html=`<div class="apt-label ${selected?.id===p.id?'selected':''}"><b>${esc(price(p))}</b><small>${esc(p.name)} · ${p.area}㎡</small></div>`;
   if(!entry){const marker=L.marker(p.coord,{icon:L.divIcon({className:'apt-marker rental-price-marker',html,iconSize:[140,48],iconAnchor:[70,24]}),title:p.name+' · '+price(p)}).addTo(map);entry={marker,html,point:p};markers.set(key,entry);marker.on('click',()=>open(entry.point));}
   else if(entry.html!==html){entry.marker.setIcon(L.divIcon({className:'apt-marker rental-price-marker',html,iconSize:[140,48],iconAnchor:[70,24]}));entry.html=html;}
   entry.point=p;
  }
  for(const [key,entry]of markers)if(!keep.has(key)){map.removeLayer(entry.marker);markers.delete(key);}
 }
 map.on('moveend',()=>{
  const c=map.getCenter(),p=new URLSearchParams(location.hash.slice(1));p.set('lat',c.lat.toFixed(5));p.set('lng',c.lng.toFixed(5));p.set('z',map.getZoom());history.replaceState(null,'','#'+p);
  draw();cancelAnimationFrame(moveFrame);moveFrame=requestAnimationFrame(refresh);
 });
 // Boundaries are independent of rental history; load them without blocking prices.
 fetch('/data/map/index.json').then(r=>{if(!r.ok)throw Error('경계 자료 오류');return r.json();}).then(payload=>{
  regionView=NodoMapRegions.create({map,payload,client:createVerifiedDataClient('/',payload.meta.sources),tap,formatAverage:average,summaryBasis:'최신 대표 계약값 산술평균',navigate:r=>map.fitBounds(r.bounds,{padding:[40,40],maxZoom:16}),report:s=>{regionFailed=s==='error';status.title=regionFailed?'행정 경계 일부를 불러오지 못했습니다.':'';}});
  regionView.setSummaries(summaries,settings.region?NodoRental.REGIONS.indexOf(settings.region):null);draw();
 }).catch(()=>{regionFailed=true;status.title='행정 경계 없이 단지 가격을 표시합니다.';draw();});
 new ResizeObserver(()=>map.invalidateSize()).observe(host);
 return {map,redraw:draw,setData(next,totals=[]){const key=[settings.type,settings.convert,settings.day,settings.contract].join(':');if(key!==contextKey){selection++;selected=null;panel.hidden=true;contextKey=key;}points=next;summaries=totals;regionView?.setSummaries(totals,settings.region?NodoRental.REGIONS.indexOf(settings.region):null);status.textContent=`현재 영역 ${points.length.toLocaleString()}개 단지 · ${settings.day} · 단지를 누르면 상세`;draw();}};
};
