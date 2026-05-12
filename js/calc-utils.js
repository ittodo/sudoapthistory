// nodostream — 공유 계산/포맷 유틸
// 메인(index.html)과 /compare/ 페이지에서 동일하게 사용
// 일부 함수는 전역 변수(PRICES, VOLUMES, DETAILS, DI, Y, retYearFrom, retYearTo, dataLastMonth)에 의존하므로
// 호출 페이지가 해당 전역을 선언/초기화하고 있어야 한다.

function forwardFill(prices){
  // 0인 월을 직전 유효값으로 채움. filled[i]=true면 forward-fill된 값
  const result=new Array(prices.length);
  const filled=new Array(prices.length);
  let last=0;
  for(let i=0;i<prices.length;i++){
    if(prices[i]>0){ last=prices[i]; result[i]=prices[i]; filled[i]=false; }
    else if(last>0){ result[i]=last; filled[i]=true; }
    else { result[i]=0; filled[i]=true; }
  }
  return {values:result, filled};
}

function fmtDate(d){if(!d)return'-';const s=String(d).padStart(8,'0');return s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6,8);}

function fmtLs(ls){
  if(!ls) return '-';
  if(typeof ls==='number') return ls.toFixed(1)+'㎡('+(ls/3.3058).toFixed(1)+'평)';
  const m=String(ls).match(/^([\d.]+)~([\d.]+)$/);
  if(m) return parseFloat(m[1]).toFixed(1)+'~'+parseFloat(m[2]).toFixed(1)+'㎡('+Math.round(parseFloat(m[1])/3.3058)+'~'+Math.round(parseFloat(m[2])/3.3058)+'평)';
  return ls+'㎡';
}

function fmtArea(a){
  if(typeof a==='number') return a+'㎡('+Math.round(a/3.3058)+'평)';
  const s=String(a);
  const m=s.match(/^([\d.]+)~([\d.]+)$/);
  if(m) return s+'㎡('+Math.round(parseFloat(m[1])/3.3058)+'~'+Math.round(parseFloat(m[2])/3.3058)+'평)';
  return s+'㎡';
}

function calcLandShare(x){ return x.ls||null; }

function getPrices(idx){ return typeof PRICES!=='undefined'&&PRICES?PRICES[String(idx)]:null; }
function getVolumes(idx){ return typeof VOLUMES!=='undefined'&&VOLUMES?VOLUMES[String(idx)]:null; }
function getDetails(idx){ return typeof DETAILS!=='undefined'&&DETAILS?DETAILS[String(idx)]:null; }

function retMonths(){
  // 선택 기간의 총 개월수 계산
  const lastY=Y[Y.length-1];
  const fromM=retYearFrom===lastY?dataLastMonth:12;
  const toM=retYearTo===lastY?dataLastMonth:12;
  // 시작년 중간~끝년 중간: (끝년-시작년-1)*12 + 끝년월수/2 + (12-시작년월수/2)
  // 간단히: 연차이 * 12, 단 끝년이 부분연도면 보정
  let months=(retYearTo-retYearFrom)*12;
  if(retYearTo===lastY&&dataLastMonth<12) months=months-12+dataLastMonth;
  return Math.max(months,1);
}

function calcRetMonths(actualFromY,toY){
  const lastY=Y[Y.length-1];
  let m=(toY-actualFromY)*12;
  if(toY===lastY&&dataLastMonth<12) m=m-12+dataLastMonth;
  return Math.max(m,1);
}

function calcReturnObj(x){
  // returns {val, years} or null  (years = "1.3" 형태 실제 기간)
  if(!PRICES) return null;
  const iTo=Y.indexOf(retYearTo);
  if(iTo<0) return null;

  function singleReturn(p){
    if(!p||!p[iTo]) return null;
    // 시작년 가격이 없으면 가장 가까운 이후 연도 탐색
    let actualFromI=Y.indexOf(retYearFrom);
    if(actualFromI<0) return null;
    while(actualFromI<iTo&&(!p[actualFromI]||p[actualFromI]===0)) actualFromI++;
    if(actualFromI>=iTo) return null;
    const pFrom=p[actualFromI], pTo=p[iTo];
    if(!pFrom||!pTo) return null;
    const months=calcRetMonths(Y[actualFromI],retYearTo);
    const totalRet=(pTo-pFrom)/pFrom*100;
    return {val:totalRet/months*12, years:(months/12)};
  }

  // 통합 엔트리: 시블링 세대수 가중평균
  if(x._merged&&x.si&&x.si.length>1){
    let wSum=0,wTotal=0,minYears=null;
    for(const idx of x.si){
      const r=singleReturn(PRICES[String(idx)]);
      if(!r) continue;
      const w=(DI[idx]&&DI[idx].u)||DI[idx]&&DI[idx].t||1;
      wSum+=r.val*w; wTotal+=w;
      if(minYears===null||r.years<minYears) minYears=r.years;
    }
    return wTotal>0?{val:wSum/wTotal, years:minYears}:null;
  }
  return singleReturn(PRICES[String(x.i)]);
}

function calcReturn(x){
  const r=calcReturnObj(x);
  return r?r.val:null;
}
