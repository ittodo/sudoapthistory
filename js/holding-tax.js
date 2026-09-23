// Amounts are KRW. Both 2027 policies are scenarios, not enacted law.
export const RULES = Object.freeze({year:2026, checked:'2026-09-23', realization:69,
  sources:{proposal:'https://www.mofe.go.kr/nw/nes/detailNesDtaView.do?searchNttId1=MOSF_000000000078809',
    revision:'https://www.mofe.go.kr/nw/nes/detailNesDtaView.do?searchNttId1=MOSF_000000000079193',
    nts:'https://www.nts.go.kr/nts/cm/cntnts/cntntsView.do?cntntsId=7739&mi=2357',
    joint:'https://www.nts.go.kr/nts/na/ntt/selectNttInfo.do?nttSn=1354762',
    ratio:'https://law.go.kr/LSW/lumLsLinkPop.do?lspttninfSeq=120262',
    baseCap:'https://www.law.go.kr/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1026501427',
    transition:'https://nabo.go.kr/board/file/down.do?fid=33319156',
    realization:'https://www.molit.go.kr/USR/NEWS/m_71/dtl.jsp?id=95091956'}});
export const EOK=100000000;
const sum = xs => xs.reduce((a,b)=>a+b,0);
export const won = x => Math.floor(Math.max(0,x)+1e-7);
export const payable = x => Math.floor((Math.max(0,x)+1e-7)/10)*10;
function number(x,name,min=0,max=1e14) {
  if(typeof x!=='number'||!Number.isFinite(x)||x<min||x>max) throw Error(`${name} 입력을 확인해주세요.`);
  return x;
}
function optional(x,name){return x==null?null:number(x,name);}
export function progressive(base,limits,rates){
  let tax=0,lower=0;
  for(let i=0;i<rates.length;i++){const upper=limits[i]??Infinity;tax+=Math.max(0,Math.min(base,upper)-lower)*rates[i];lower=upper;}
  return tax;
}
export function propertyRate(price,single){return single?(price<=3*EOK?.43:price<=6*EOK?.44:.45):.6;}
export function propertyTax(base,special=false){return progressive(base,[.6*EOK,1.5*EOK,3*EOK],special?[.0005,.001,.002,.0035]:[.001,.0015,.0025,.004]);}
export function comprehensiveTax(base,count){return progressive(base,[3,6,12,25,50,94].map(x=>x*EOK),count>=3?[.005,.007,.01,.02,.03,.04,.05]:[.005,.007,.01,.013,.015,.02,.027]);}
export function reformTax(base,count){return progressive(base,[3,6,12,25,50,94].map(x=>x*EOK),count>=3?[.005,.007,.013,.02,.03,.04,.05]:[.005,.007,.013,.015,.02,.027,.035]);}
const durationCredit=years=>years>=15?.5:years>=10?.4:years>=5?.2:0;
export function reformCreditRate(age,years,residenceYears){return Math.min(.8,creditRate(age,0)+Math.max(durationCredit(years)/2,durationCredit(residenceYears)));}
export function creditRate(age,years){return Math.min(.8,(age>=70?.4:age>=65?.3:age>=60?.2:0)+(years>=15?.5:years>=10?.4:years>=5?.2:0));}
export function assessedPair(value,{basis='market',ratio=69,nextRatio=69,growth=0}={}){
  number(value,'가격');number(growth,'가격 변동률',-100,1000);
  if(!['market','assessed'].includes(basis))throw Error('가격 기준을 확인해주세요.');
  if(basis==='market'){number(ratio,'올해 현실화율',.01,100);number(nextRatio,'내년 현실화율',.01,100);}
  return basis==='market'?[Math.round(value*ratio/100),Math.round(value*(1+growth/100)*nextRatio/100)]:[Math.round(value),Math.round(value*(1+growth/100))];
}
function validate(input){
  const {houses,owners,singleHousehold=true,jointSpecial=false,specialOwner=0}=input;
  if(!['current','reform'].includes(input.policy??'current'))throw Error('세제 시나리오를 확인해주세요.');
  if(input.policy==='reform'&&input.year!==2027)throw Error('개편안은 2027년에만 적용합니다.');
  if(input.residenceHouse!=null&&(!Number.isInteger(input.residenceHouse)||input.residenceHouse < -1||input.residenceHouse>=houses.length))throw Error('거주 주택을 확인해주세요.');
  if(![2026,2027].includes(input.year))throw Error('지원 연도는 2026년과 2027년입니다.');
  if(!Array.isArray(houses)||!houses.length||houses.length>20)throw Error('주택은 1~20채를 입력해주세요.');
  if(!Array.isArray(owners)||!owners.length||owners.length>2)throw Error('소유자는 1~2명입니다.');
  owners.forEach(o=>{number(o.age,'나이',0,130);number(o.years,'보유기간',0,130);number(o.residenceYears??0,'거주기간',0,130);optional(o.previousEquivalent,'전년도 종부세 상한용 총세액상당액');});
  houses.forEach(h=>{
    number(h.assessed,'공시가격');optional(h.previousAssessed,'전년도 공시가격');
    optional(h.previousMain,'전년도 재산세 본세 상당액');optional(h.previousCity,'전년도 도시지역분 상당액');
    if(!Array.isArray(h.shares)||h.shares.length!==owners.length)throw Error('소유자별 지분을 확인해주세요.');
    h.shares.forEach(s=>number(s,'지분',0,1));
    if(Math.abs(sum(h.shares)-1)>1e-8)throw Error('주택별 지분의 합은 100%여야 합니다.');
  });
  if(singleHousehold&&houses.length!==1)throw Error('1세대 1주택 조건과 주택 수가 다릅니다.');
  if(jointSpecial&&(!singleHousehold||houses.length!==1||owners.length!==2||houses[0].shares.some(s=>s<=0)||![0,1].includes(specialOwner)))throw Error('공동명의 특례는 부부가 함께 소유한 1세대 1주택에만 적용합니다.');
  optional(input.resourceTax,'지역자원시설세');
}
export function calculateYear(input){
  validate(input);
  const {houses,owners,year,singleHousehold=true,jointSpecial=false,specialOwner=0,applyCaps=false,resourceTax=null}=input;
  const reform=year===2027&&input.policy==='reform',residenceHouse=input.residenceHouse??-1;
  const notes=new Set();
  if(reform)notes.add('2027년은 2026.9.1 수정 정부안 적용 가정입니다. 국회 확정 전이며 재산세 한시 특례·비율은 2026년 유지 가정입니다.');
  else if(year===2027)notes.add('2027년은 2026년 세율·공제·한시 특례가 유지된다는 가정입니다. 확정된 내년 고지세액이 아닙니다.');
  if(!applyCaps)notes.add('과세표준·세부담 상한 적용 전 추정치');
  if(resourceTax==null)notes.add('지역자원시설세 제외');
  const property=houses.map((h,index)=>{
    const ratio=propertyRate(h.assessed,singleHousehold),rawBase=won(h.assessed*ratio);
    let base=rawBase;
    // Art.110(3): prior assessed value × CURRENT ratio + CURRENT raw base × 5%.
    if(applyCaps&&h.previousAssessed!=null)base=Math.min(rawBase,won(h.previousAssessed*ratio+rawBase*.05));
    else if(applyCaps)notes.add(`주택 ${index+1}: 전년도 공시가격 미입력으로 과표 상한 미적용`);
    const rawMain=propertyTax(base,singleHousehold&&h.assessed<=9*EOK),rawCity=h.urban===false?0:base*.0014;
    let main=rawMain,city=rawCity;
    // Transitional burden cap for homes taxed by 2022, through 2028.
    if(applyCaps&&h.legacyCap){
      const factor=h.assessed<=3*EOK?1.05:h.assessed<=6*EOK?1.1:1.3;
      if(h.previousMain!=null)main=Math.min(main,h.previousMain*factor);else notes.add(`주택 ${index+1}: 전년도 본세 상당액 미입력으로 본세 상한 미적용`);
      if(h.urban!==false){if(h.previousCity!=null)city=Math.min(city,h.previousCity*factor);else notes.add(`주택 ${index+1}: 전년도 도시지역분 상당액 미입력으로 도시지역분 상한 미적용`);}
    }
    const allocations=h.shares.map(share=>({main:payable(main*share),city:payable(city*share),education:payable(main*share*.2)}));
    return {assessed:h.assessed,ratio,rawBase,base,rawMain,rawCity,main:sum(allocations.map(x=>x.main)),city:sum(allocations.map(x=>x.city)),education:sum(allocations.map(x=>x.education)),allocations,shares:h.shares};
  });
  const comprehensive=owners.map((o,index)=>{
    const inactive=jointSpecial&&index!==specialOwner;
    const weights=houses.map(h=>inactive?0:jointSpecial?1:h.shares[index]);
    const count=weights.filter(w=>w>0).length;
    const assessed=sum(houses.map((h,i)=>h.assessed*weights[i]));
    const single=singleHousehold&&(jointSpecial||houses[0].shares[index]===1);
    const residentValue=residenceHouse>=0?houses[residenceHouse].assessed*weights[residenceHouse]:0;
    const jointHouse=singleHousehold&&owners.length===2&&!jointSpecial;
    const deduction=reform?(single?(residentValue>0?14:12)*EOK:jointHouse?(residentValue>0?9:6)*EOK:4*EOK+5*EOK*(assessed?residentValue/assessed:0)):(single?12:9)*EOK;
    // Proposal separates entry threshold from the deduction, including nonresidents.
    const threshold=(single?(reform?14:12):9)*EOK,ratio=reform?.7:.6;
    const base=assessed>threshold?won(Math.max(0,assessed-deduction)*ratio):0;
    const gross=won(reform?reformTax(base,count):comprehensiveTax(base,count));
    const actualProperty=sum(property.map((p,i)=>jointSpecial?(inactive?0:p.main):p.allocations[index].main));
    const combinedPropertyBase=sum(property.map((p,i)=>p.assessed*p.ratio*weights[i]));
    const denominator=propertyTax(combinedPropertyBase);
    const weightedRatio=assessed?combinedPropertyBase/assessed:0;
    // NTS declaration: numerator = CRE base × property fair-market ratio × 0.4%.
    const overlap=won(Math.min(gross,actualProperty,denominator?actualProperty*(base*weightedRatio*.004)/denominator:0));
    const rate=single&&!inactive?(reform?reformCreditRate(o.age,o.years,o.residenceYears??0):creditRate(o.age,o.years)):0;
    const creditLimit=reform?8000000:Infinity;
    const credit=won(Math.min(creditLimit,(gross-overlap)*rate)),beforeCap=Math.max(0,gross-overlap-credit);
    let tax=beforeCap;
    if(applyCaps&&!inactive){
      if(o.previousEquivalent!=null)tax=Math.min(tax,Math.max(0,o.previousEquivalent*1.5-actualProperty));
      else if(base>0)notes.add(`소유자 ${index+1}: 전년도 총세액상당액 미입력으로 종부세 상한 미적용`);
    }
    tax=payable(tax);
    return {index,count,assessed,threshold,ratio,creditLimit,deduction:inactive?0:deduction,base,gross,actualProperty,overlap,creditRate:rate,credit,beforeCap,capReduction:beforeCap-tax,tax,rural:payable(tax*.2)};
  });
  const main=sum(property.map(p=>p.main)),city=sum(property.map(p=>p.city)),education=sum(property.map(p=>p.education));
  const cre=sum(comprehensive.map(p=>p.tax)),rural=sum(comprehensive.map(p=>p.rural));
  const resource=resourceTax==null?0:payable(resourceTax);
  const ownerTotals=owners.map((o,i)=>({index:i,property:sum(property.map(p=>p.allocations[i].main+p.allocations[i].city+p.allocations[i].education)),cre:comprehensive[i].tax+comprehensive[i].rural}));
  return {year,property,comprehensive,ownerTotals,assessed:sum(houses.map(h=>h.assessed)),main,city,education,cre,rural,resource,propertyTotal:main+city+education,creTotal:cre+rural,total:main+city+education+cre+rural+resource,notes:[...notes]};
}
export function compareYears(current,next){
  const a=calculateYear(current),b=calculateYear(next),delta=b.total-a.total;
  const uncappedNext=next.applyCaps?calculateYear({...next,applyCaps:false}):b;
  return {current:a,next:b,uncappedNext,capSavings:uncappedNext.total-b.total,delta,percent:a.total?delta/a.total*100:null};
}
// For unchanged properties/owners, next-year CRE burden reference excludes last
// year's burden cap (enforcement decree art.5), but retains the base cap.
export function nextYearInput(current,nextPrices,{resourceTax=null,policy='current'}={}){
  const reference=calculateYear({...current,owners:current.owners.map(o=>({...o,previousEquivalent:null})),houses:current.houses.map(h=>({...h,legacyCap:false}))});
  const actual=calculateYear(current);
  return {...current,year:2027,policy,resourceTax,
    owners:current.owners.map((o,i)=>({...o,age:o.age+1,years:o.years+1,residenceYears:(o.residenceYears??0)+((current.residenceHouse??-1)>=0?1:0),previousEquivalent:reference.comprehensive[i].actualProperty+reference.comprehensive[i].beforeCap})),
    houses:current.houses.map((h,i)=>({...h,assessed:nextPrices[i],previousAssessed:h.assessed,previousMain:actual.property[i].main,previousCity:actual.property[i].city}))};
}
export function makeScenario(value,settings={}){
  const mode=settings.mode||'single',joint=mode==='joint'||mode==='special';
  if(!['single','joint','special','two','three'].includes(mode))throw Error('보유 유형을 확인해주세요.');
  const count=mode==='two'?2:mode==='three'?3:1;
  const share=joint?number(settings.share??50,'본인 지분',.01,99.99)/100:1;
  const prices=assessedPair(value,settings);
  const split=total=>Array.from({length:count},(_,i)=>Math.floor(total/count)+(i<total%count?1:0));
  const amounts=split(prices[0]),nextAmounts=split(prices[1]);
  const current={year:2026,residenceHouse:settings.residenceHouse??-1,singleHousehold:count===1&&(settings.singleHousehold!==false),jointSpecial:mode==='special',specialOwner:settings.specialOwner??0,
    owners:[{age:settings.age??40,years:settings.years??0,residenceYears:settings.residenceYears??0},...(joint?[{age:settings.spouseAge??40,years:settings.spouseYears??0,residenceYears:settings.spouseResidenceYears??0}]:[])],
    houses:amounts.map(p=>({assessed:p,shares:joint?[share,1-share]:[1],urban:settings.urban!==false})),applyCaps:false};
  const next=nextYearInput(current,nextAmounts,{policy:settings.policy??'current'});
  next.applyCaps=settings.applyNextCaps===true;
  return {current,next};
}
