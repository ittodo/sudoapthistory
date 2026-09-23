// Individual, registered housing sold under the 2026 current rules.
const EOK=1e8;
const floor10=n=>Math.floor((Math.max(0,n)+1e-6)/10)*10;
export function acquisitionTax({price,houses=1,adjusted=false,large=false,excluded=false}){
  const ordinary=price<=6*EOK?.01:price>9*EOK?.03:Math.round((price/EOK*2/3-3)*10000)/1e6;
  const heavy=excluded?0:houses>=4||adjusted&&houses>=3?.12:houses>=3||adjusted&&houses===2?.08:0;
  const rate=heavy||ordinary;
  const main=floor10(price*rate),education=floor10(price*(heavy?.004:rate/10));
  const rural=large?floor10(price*(heavy===.12?.01:heavy===.08?.006:.002)):0;
  return {rate,main,education,rural,total:main+education+rural};
}
export function incomeTax(base){
  const ends=[14e6,50e6,88e6,150e6,300e6,500e6,1e9,Infinity],rates=[.06,.15,.24,.35,.38,.40,.42,.45];
  let total=0,previous=0;
  for(let i=0;i<ends.length;i++){total+=Math.max(0,Math.min(base,ends[i])-previous)*rates[i];previous=ends[i];if(base<=previous)break;}
  return total;
}
export function capitalGainsTax({purchase,sale,expenses=0,years,residence=0,houses=1,acquiredAdjusted=false,saleAdjusted=false,excluded=false,basic=2500000}){
  const held=Math.floor(years),lived=Math.floor(Math.min(years,residence));
  const gain=Math.max(0,sale-purchase-expenses);
  const eligible=houses===1&&years>=2&&(!acquiredAdjusted||lived>=2);
  const taxableGain=eligible?gain*Math.max(0,sale-12*EOK)/sale:gain;
  const surcharge=houses>=2&&saleAdjusted&&!excluded?(houses===2?.2:.3):0;
  const deductionRate=surcharge||held<3?0:eligible&&lived>=2?Math.min(held,10)*.04+Math.min(lived,10)*.04:Math.min(held,15)*.02;
  const deduction=Math.floor(taxableGain*deductionRate+1e-6);
  const base=Math.max(0,Math.floor(taxableGain+1e-6)-deduction-basic);
  const shortRate=years<1?.7:years<2?.6:0;
  const national=floor10(Math.max(incomeTax(base)+base*surcharge,base*shortRate));
  const local=floor10(national*.1),total=national+local;
  return {gain,taxableGain,eligible,deductionRate,deduction,base,national,local,total,surcharge,shortRate,net:sale-purchase-expenses-total};
}
