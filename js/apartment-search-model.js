import {disassemble, getChoseong} from 'es-hangul';

const initial = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const vowel = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
const final = 'ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ';
export function normalize(value) {
  return String(value || '').normalize('NFKC').replace(/[\u1100-\u1112\u1161-\u1175\u11a8-\u11c2]/g,c=>initial[c.charCodeAt(0)-0x1100] || vowel[c.charCodeAt(0)-0x1161] || final[c.charCodeAt(0)-0x11a8] || c).toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
}
const compare = (a,b) => a < b ? -1 : a > b ? 1 : 0;
export function inScope(c,scope={}) {
  const r = scope.r;
  const district = Array.isArray(scope.g) ? scope.g : String(scope.g || '').split(',').filter(Boolean);
  return (r === '' || r == null || Number(r) === c.r) && (!district.length || district.includes(c.g));
}
export function createIndex(data) {
  if(data.schema!==1 || !Array.isArray(data.apartments))throw Error('검색 자료의 형식을 확인할 수 없습니다.');
  const byId = new Map(), regions = new Map(), districts = new Map();
  const entries = data.apartments.map(c=>{
    const names = [...new Set([c.name,...c.aliases].map(normalize))].filter(Boolean).map(n=>({n,j:disassemble(n),initial:getChoseong(n,{keepNonHangul:true}),chars:[...n]}));
    const e={c,names,place:normalize([['경기 경기도','서울 서울특별시','인천 인천광역시'][c.r],c.g,c.d,...c.addresses].join(' '))};
    byId.set(c.id,c);
    for(const key of c.keys)if(!byId.has(key))byId.set(key,c);
    if(!regions.has(c.r))regions.set(c.r,[]);regions.get(c.r).push(e);
    if(!districts.has(c.g))districts.set(c.g,[]);districts.get(c.g).push(e);
    return e;
  });
  return {entries,byId,regions,districts};
}

// Banded Levenshtein, bounded to the allowed normalized distance.
export function editDistance(a,b,limit) {
  if(Math.abs(a.length-b.length)>limit)return Infinity;
  let prev=Array.from({length:b.length+1},(_,i)=>i),next=new Array(b.length+1);
  for(let i=1;i<=a.length;i++){
    next.fill(Infinity);next[0]=i;let min=Infinity;
    for(let j=Math.max(1,i-limit);j<=Math.min(b.length,i+limit);j++){
      next[j]=Math.min(prev[j]+1,next[j-1]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));min=Math.min(min,next[j]);
    }
    if(min>limit)return Infinity;
    [prev,next]=[next,prev];
  }
  return prev[b.length];
}
function mixedMatch(name,term) {
  for(let start=0;start<=name.chars.length-term.chars.length;start++){
    let ok=true;
    for(let i=0;i<term.chars.length;i++){
      const a=term.chars[i],b=name.chars[start+i];
      if(a===b || initial.includes(a)&&name.initial[start+i]===a)continue;
      if(i===term.chars.length-1 && disassemble(b).startsWith(disassemble(a)))continue;
      ok=false;break;
    }
    if(ok)return true;
  }
  return false;
}
function nameRank(name,term,fuzzy) {
  if(name.n===term.n)return [0,0];
  if(name.n.startsWith(term.n))return [1,0];
  if(name.n.includes(term.n))return [2,0];
  if(name.j.includes(term.j) || (term.initialOnly ? name.initial.includes(term.n) : term.mixed && mixedMatch(name,term)))return [3,0];
  if(!fuzzy || !term.fuzzy)return null;
  const max=Math.max(name.j.length,term.j.length),limit=Math.floor(max*.25);
  const distance=editDistance(name.j,term.j,limit);
  return distance<=limit ? [4,distance/max] : null;
}
function termOf(n) {return {n,j:disassemble(n),chars:[...n],initialOnly:/^[ㄱ-ㅎ]+$/.test(n),mixed:/[ㄱ-ㅎㅏ-ㅣ]/.test(n),fuzzy:(n.match(/[가-힣]/g)||[]).length>=3};}
function numbers(n) {return [...n.matchAll(/(\d+)(단지|차)/g)].map(m=>[m[2],m[1]]);}
function score(e,whole,terms,fuzzy) {
  const required=numbers(whole.n);
  if(required.some(([kind,num])=>!e.names.some(name=>numbers(name.n).some(([k,n])=>k===kind && n===num))))return null;
  if(terms.length>1 && terms.some(term=>!e.place.includes(term.n)&&!e.names.some(name=>nameRank(name,term,fuzzy))))return null;
  let best=null;
  for(const name of e.names){const result=nameRank(name,whole,fuzzy);if(result && (!best || result[0]<best[0] || result[0]===best[0] && result[1]<best[1]))best=result;}
  if(!best && terms.length>1){
    let rank=0,distance=0,nameTerms=0;
    for(const term of terms){
      let match=null;
      for(const name of e.names){const r=nameRank(name,term,fuzzy);if(r && (!match || r[0]<match[0] || r[0]===match[0]&&r[1]<match[1]))match=r;}
      if(e.place.includes(term.n) && (!match || match[0]>2))continue;
      if(!match)return null;
      nameTerms++;rank=Math.max(rank,match[0]);distance+=match[1];
    }
    best=[nameTerms?rank:2,distance];
  }
  if(!best && e.place.includes(whole.n))best=[2,0];
  return best && [...best,Math.min(...e.names.map(n=>Math.abs(n.n.length-whole.n.length)))];
}
export function highlights(name,query) {
  const chars=[...name],clean=[],positions=[];
  chars.forEach((c,i)=>{for(const n of normalize(c)){clean.push(n);positions.push(i);}});
  const text=clean.join(''),initials=getChoseong(text,{keepNonHangul:true}),jamo=[],jamoPositions=[],ranges=[];
  clean.forEach((c,i)=>{for(const part of disassemble(c)){jamo.push(part);jamoPositions.push(positions[i]);}});
  function add(text,term,map){let from=0,at;while((at=text.indexOf(term,from))>=0){ranges.push([map[at],map[at+term.length-1]+1]);from=at+term.length;}}
  for(const n of [normalize(query),...query.split(/\s+/).map(normalize)].filter(Boolean)){
    add(text,n,positions);add(jamo.join(''),disassemble(n),jamoPositions);
    const term=termOf(n);
    if(term.initialOnly)add(initials,n,positions);
    else if(term.mixed)for(let at=0;at<=clean.length-term.chars.length;at++){
      if(mixedMatch({chars:clean.slice(at,at+term.chars.length),initial:initials.slice(at,at+term.chars.length)},term))ranges.push([positions[at],positions[at+term.chars.length-1]+1]);
    }
  }
  ranges.sort((a,b)=>a[0]-b[0]);const merged=[];
  for(const r of ranges){const last=merged.at(-1);if(last&&r[0]<=last[1])last[1]=Math.max(last[1],r[1]);else merged.push(r);}
  return merged;
}
export function search(index,query,scope={},limit=10) {
  query=String(query||'').trim().slice(0,120);const n=normalize(query);if(!n)return [];
  const whole=termOf(n),terms=query.split(/\s+/).map(normalize).filter(Boolean).map(termOf);
  const gs=Array.isArray(scope.g)?scope.g:String(scope.g||'').split(',').filter(Boolean);
  const pool=gs.length ? gs.flatMap(g=>index.districts.get(g)||[]) : scope.r!=='' && scope.r!=null ? index.regions.get(Number(scope.r))||[] : index.entries;
  const matches=[];
  // Most queries fill the popup with exact/partial matches; typo work is only needed below them.
  const unmatched=[];
  for(const e of pool){if(!inScope(e.c,scope))continue;const s=score(e,whole,terms,false);if(s)matches.push({e,s});else unmatched.push(e);}
  if(matches.length<limit && (whole.fuzzy || terms.some(t=>t.fuzzy)))for(const e of unmatched){const s=score(e,whole,terms,true);if(s)matches.push({e,s});}
  matches.sort((a,b)=>a.s[0]-b.s[0]||a.s[1]-b.s[1]||a.s[2]-b.s[2]||compare(a.e.c.name,b.e.c.name)||compare(a.e.c.g+' '+a.e.c.d+' '+a.e.c.addresses.join(' '),b.e.c.g+' '+b.e.c.d+' '+b.e.c.addresses.join(' '))||compare(a.e.c.id,b.e.c.id));
  return matches.slice(0,Math.min(10,limit)).map(({e})=>({...e.c,highlights:highlights(e.c.name,query)}));
}
