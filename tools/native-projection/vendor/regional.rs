//! Append-only regional identities and cumulative immutable-baseline overlays.
//! Metadata and approvals never participate in trade identity or cache signatures.
use crate::Result;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
pub struct Region {
    pub complexes: Vec<String>,
    pub areas: Vec<(usize, String)>,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
pub struct Authority {
    pub regions: BTreeMap<String, Region>,
}
pub fn lawd(code: &str) -> Result<()> {
    if code.len()!=5 || !code.bytes().all(|b| b.is_ascii_digit()) {
        return Err("Five-digit LAWD required".into());
    }
    Ok(())
}
pub fn decimal_area(raw: &str) -> Result<String> {
    let parts=raw.split('.').collect::<Vec<_>>();
    if parts.len()>2 || parts[0].is_empty() || !parts[0].bytes().all(|b|b.is_ascii_digit()) ||
       parts.get(1).is_some_and(|s|s.is_empty()||!s.bytes().all(|b|b.is_ascii_digit())) {
        return Err("Exact positive decimal area required".into());
    }
    let whole=parts[0].trim_start_matches('0');
    let whole=if whole.is_empty(){"0"}else{whole};
    let fraction=parts.get(1).copied().unwrap_or("").trim_end_matches('0');
    if whole=="0" && fraction.is_empty(){return Err("Zero area is invalid".into());}
    Ok(if fraction.is_empty(){whole.to_owned()}else{format!("{whole}.{fraction}")})
}
impl Authority {
    pub fn validate(&self) -> Result<()> {
        let mut sources=BTreeSet::new();
        for (code,r) in &self.regions {
            lawd(code)?;
            for source in &r.complexes {
                if source.is_empty()||source.trim()!=source||!sources.insert(source) {
                    return Err("Duplicate or empty permanent source identity".into());
                }
            }
            let mut areas=BTreeSet::new();
            for (ci,a) in &r.areas {
                if *ci>=r.complexes.len() || decimal_area(a)?!=*a || !areas.insert((*ci,a)) {
                    return Err("Invalid or duplicate permanent exact-area identity".into());
                }
            }
        }
        Ok(())
    }
    pub fn continuity(&self, previous:&Self)->Result<()> {
        self.validate()?;previous.validate()?;
        for (code,old) in &previous.regions {
            let new=self.regions.get(code).ok_or("Permanent region removed")?;
            if !new.complexes.starts_with(&old.complexes)||!new.areas.starts_with(&old.areas) {
                return Err("Permanent identities removed, reused or renumbered".into());
            }
        }
        Ok(())
    }
    pub fn source(&self, source:&str)->Option<(String,usize)> {
        self.regions.iter().find_map(|(code,r)|r.complexes.iter().position(|s|s==source).map(|ci|(code.clone(),ci)))
    }
    pub fn complex(&mut self, code:&str, source:&str)->Result<(String,usize)> {
        // Existing identity wins even when current administration/metadata changes.
        if let Some(key)=self.source(source){return Ok(key);}
        lawd(code)?;
        if source.is_empty()||source.trim()!=source{return Err("Source identity required".into());}
        let r=self.regions.entry(code.to_owned()).or_default();
        let ci=r.complexes.len();r.complexes.push(source.to_owned());
        Ok((code.to_owned(),ci))
    }
    pub fn area(&mut self, code:&str, ci:usize, raw:&str)->Result<usize> {
        let a=decimal_area(raw)?;
        let r=self.regions.get_mut(code).ok_or("Unknown permanent region")?;
        if ci>=r.complexes.len(){return Err("Unknown permanent complex".into());}
        if let Some(ai)=r.areas.iter().position(|entry|entry==&(ci,a.clone())){return Ok(ai);}
        let ai=r.areas.len();r.areas.push((ci,a));Ok(ai)
    }
}
pub fn key(code:&str, local:usize)->String {format!("{code}:{local}")}
/// Resolve current administration from explicit evidence, never fuzzy address identity.
pub fn district_codes(bjd:&Value)->Result<BTreeMap<(u64,String),String>> {
    let mut candidates:BTreeMap<(u64,String),BTreeSet<String>>=BTreeMap::new();
    for (k,v) in bjd.as_object().ok_or("District dictionary required")? {
        if v.is_null(){continue;}
        let p=k.split('|').collect::<Vec<_>>();
        if p.len()<2{return Err("Invalid district dictionary key".into());}
        let code=v["sigunguCd"].as_str().ok_or("District code missing")?;lawd(code)?;
        candidates.entry((p[0].parse()?,p[1].to_owned())).or_default().insert(code.to_owned());
    }
    let mut result=BTreeMap::new();
    for (k,v) in candidates {if v.len()==1{result.insert(k,v.into_iter().next().unwrap());}}
    Ok(result)
}
pub fn resolve_region(metadata:&Value,codes:&BTreeMap<(u64,String),String>)->Result<String> {
    let district=metadata["g"].as_str().ok_or("Current district missing")?;
    if lawd(district).is_ok(){return Ok(district.to_owned());}
    codes.get(&(metadata["r"].as_u64().ok_or("Province missing")?,district.to_owned()))
        .cloned().ok_or_else(||format!("Ambiguous or unknown current LAWD: {district}").into())
}
fn normalize(v:&Value)->Value {
    match v {
        Value::Array(a)=>Value::Array(a.iter().map(normalize).collect()),
        Value::Object(m)=>Value::Object(m.iter().map(|(k,v)|(k.clone(),normalize(v))).collect()),
        Value::Number(n)=>{
            if let Some(f)=n.as_f64().filter(|f|f.fract()==0.0&&f.abs()<=9_007_199_254_740_991.0){json!(f as i64)}else{v.clone()}
        },
        _=>v.clone()
    }
}
pub fn canonical(v:&Value)->Result<String>{Ok(serde_json::to_string(&normalize(v))?)}
pub fn digest(v:&Value)->Result<String>{Ok(format!("{:x}",Sha256::digest(canonical(v)?.as_bytes())))}
fn counts(rows:&[Value])->Result<BTreeMap<String,(Value,usize)>> {
    let mut out=BTreeMap::new();
    for row in rows {let k=canonical(row)?;let e=out.entry(k).or_insert((normalize(row),0));e.1+=1;}
    Ok(out)
}
/// Cumulative difference against one fixed baseline, never a previous overlay.
pub fn delta(base:&[Value],current:&[Value])->Result<Value> {
    let b=counts(base)?;let c=counts(current)?;let mut remove=Vec::new();let mut add=Vec::new();
    for (k,(row,n)) in &b {let count=c.get(k).map_or(0,|v|v.1);if *n>count{remove.push(json!([row,n-count]));}}
    for (k,(row,n)) in &c {let count=b.get(k).map_or(0,|v|v.1);for _ in count..*n{add.push(row.clone());}}
    Ok(json!({"remove":remove,"add":add}))
}
pub fn apply(base:&[Value],change:&Value)->Result<Vec<Value>> {
    let mut removals:BTreeMap<String,usize>=BTreeMap::new();
    for pair in change["remove"].as_array().ok_or("Overlay remove list missing")? {
        let pair=pair.as_array().filter(|p|p.len()==2).ok_or("Invalid overlay removal")?;
        let n=pair[1].as_u64().filter(|n|*n>0).ok_or("Invalid removal count")? as usize;
        let k=canonical(&pair[0])?;
        if removals.insert(k,n).is_some(){return Err("Duplicate removal vector".into());}
    }
    let mut result=Vec::new();
    for row in base {
        let k=canonical(row)?;
        if let Some(n)=removals.get_mut(&k).filter(|n|**n>0){*n-=1;}else{result.push(row.clone());}
    }
    if removals.values().any(|n|*n!=0){return Err("Overlay removes unavailable baseline rows".into());}
    result.extend(change["add"].as_array().ok_or("Overlay add list missing")?.iter().cloned());
    Ok(result)
}
/// Allocate content/duplicate IDs while preserving verified legacy tie ordering.
#[derive(Default)]
pub struct RecordIds {pool:BTreeMap<String,Vec<String>>,used:BTreeMap<String,usize>}
impl RecordIds {
    pub fn seed(&mut self,fact:&Value,id:&str)->Result<()> {
        if id.is_empty(){return Err("Legacy record identity missing".into());}
        self.pool.entry(canonical(fact)?).or_default().push(id.to_owned());Ok(())
    }
    pub fn finish(&mut self) {for ids in self.pool.values_mut(){ids.sort();}}
    pub fn allocate(&mut self,fact:&Value)->Result<String> {
        let content=canonical(fact)?;
        let n=self.used.entry(content.clone()).or_default();let rank=*n;*n+=1;
        if let Some(id)=self.pool.get(&content).and_then(|ids|ids.get(rank)){return Ok(id.clone());}
        Ok(format!("{}:{rank}",&format!("{:x}",Sha256::digest(content.as_bytes()))[..24]))
    }
}

/// SQL literals are source identities, never interpolated SQL clauses.
pub fn sql_sources(values:&[Value])->Result<String> {
    let ids=values.iter().map(|v|v["id"].as_str().ok_or("Source ID missing").map(|s|format!("'{}'",s.replace('\'',"''")))).collect::<std::result::Result<Vec<_>,_>>()?;
    if ids.is_empty(){return Ok("NULL".to_owned());}Ok(ids.join(","))
}
pub fn pool(directory:Option<&std::path::Path>,month:&str,kind:&str)->Result<RecordIds> {
    let mut result=RecordIds::default();
    if let Some(directory)=directory {
        let name=format!("{month}-{kind}.bin");let path=directory.join(&name);
        let index:Value=serde_json::from_slice(&std::fs::read(directory.join("index.json"))?)?;
        if index["files"].get(&name).is_some(){
            let bytes=std::fs::read(&path)?;
            let actual=format!("{:x}",Sha256::digest(&bytes));
            if index["files"][&name]!=actual{return Err("Immutable baseline record pool changed".into());}
            use std::io::Read;
            let mut raw=Vec::new();flate2::read::GzDecoder::new(std::fs::File::open(&path)?).read_to_end(&mut raw)?;
            let value:Value=serde_json::from_slice(&raw)?;
            for row in value.as_array().ok_or("Record pool missing")? {
                result.seed(&row[0],row[1].as_str().ok_or("Record ID missing")?)?;
            }
            result.finish();
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shared_local_ids_are_append_only_and_metadata_independent() {
        let mut a=Authority::default();assert_eq!(a.complex("11110","source-A").unwrap(),("11110".into(),0));
        assert_eq!(a.complex("41110","source-B").unwrap(),("41110".into(),0));
        assert_ne!(key("11110",0),key("41110",0));
        assert_eq!(a.area("11110",0,"084.0500").unwrap(),0);
        assert_eq!(a.area("11110",0,"84.05").unwrap(),0);
        assert_eq!(a.area("11110",0,"84.1").unwrap(),1);
        let old=a.clone();a.complex("11110","new-source").unwrap();a.area("11110",1,"59.93").unwrap();a.continuity(&old).unwrap();
        assert_eq!(a.complex("41591","source-A").unwrap(),("11110".into(),0));
        assert_eq!(old.regions["11110"].areas,a.regions["11110"].areas[..2]);
        let mut bad=a.clone();bad.regions.get_mut("11110").unwrap().complexes.swap(0,1);assert!(bad.continuity(&old).is_err());
        for area in ["0","-1","1e2","84.",".9"]{assert!(decimal_area(area).is_err());}
    }
    #[test]
    fn reordered_duplicate_records_produce_no_change_and_corrections_are_cumulative() {
        let a=json!(["11110:0",20260901,100,1]);let b=json!(["41110:0",20260901,200,2]);
        let base=vec![a.clone(),a.clone(),b.clone()];
        assert_eq!(delta(&base,&[b.clone(),a.clone(),a.clone()]).unwrap(),json!({"remove":[],"add":[]}));
        let corrected=vec![a.clone(),b.clone(),json!(["11110:0",20260901,101,1])];
        let d=delta(&base,&corrected).unwrap();assert_eq!(counts(&apply(&base,&d).unwrap()).unwrap(),counts(&corrected).unwrap());
        assert!(apply(&[],&d).is_err());
        assert_eq!(canonical(&json!([1.0,2])).unwrap(),canonical(&json!([1,2.0])).unwrap());
    }
    #[test]
    fn legacy_tie_order_is_preserved_and_new_ids_ignore_response_order() {
        let fact=json!(["11110:0","84.05",20260901,100,0,1,3,0]);let mut ids=RecordIds::default();
        ids.seed(&fact,"bb").unwrap();ids.seed(&fact,"aa").unwrap();ids.finish();
        assert_eq!(ids.allocate(&fact).unwrap(),"aa");assert_eq!(ids.allocate(&fact).unwrap(),"bb");
        let third=ids.allocate(&fact).unwrap();let mut again=RecordIds::default();again.seed(&fact,"aa").unwrap();again.seed(&fact,"bb").unwrap();again.finish();
        again.allocate(&fact).unwrap();again.allocate(&fact).unwrap();assert_eq!(third,again.allocate(&fact).unwrap());
        assert_ne!(third,again.allocate(&fact).unwrap());
    }
    #[test]
    fn current_district_resolves_administration_without_rewriting_source_key() {
        let c=district_codes(&json!({"0|효행구|a":{"sigunguCd":"41591"},"0|효행구|b":{"sigunguCd":"41591"},"1|종로구|a":{"sigunguCd":"11110"},"0|x|a":null})).unwrap();
        assert_eq!(resolve_region(&json!({"id":"41590-123","r":0,"g":"효행구"}),&c).unwrap(),"41591");
        assert!(resolve_region(&json!({"r":0,"g":"미상"}),&c).is_err());
    }
}
