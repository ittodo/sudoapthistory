//! Verified calculation convergence: keep corrected prefixes and immutable suffix outputs.
use crate::Result;
use serde_json::{json,Value};
use std::collections::{BTreeMap,BTreeSet};
pub fn same_inputs_after(old:&Value,new:&Value,month:&str)->bool{
 let(Some(a),Some(b))=(old.as_object(),new.as_object())else{return false};let keys:BTreeSet<_>=a.keys().chain(b.keys()).collect();keys.into_iter().filter(|m|m.as_str()>month).all(|m|a.get(m)==b.get(m))
}
pub fn summaries(old:&Value,new:&Value,month:&str)->Result<Value>{
 let mut merged:BTreeMap<String,Value>=old.as_object().ok_or("Old summaries missing")?.iter().filter(|(k,_)|k.as_str().get(..7).is_some_and(|m|m>month)).map(|(k,v)|(k.clone(),v.clone())).collect();
 for(k,v)in new.as_object().ok_or("Corrected summaries missing")?{if k.get(..7).is_some_and(|m|m<=month){merged.insert(k.clone(),v.clone());}}
 Ok(serde_json::to_value(merged)?)
}
pub fn counts(final_counts:&Value,old_prefix:&Value,new_prefix:&Value)->Result<Value>{
 let mut result=json!({});let keys:BTreeSet<_>=[final_counts,old_prefix,new_prefix].into_iter().filter_map(Value::as_object).flat_map(|m|m.keys()).collect();for k in keys{let f=final_counts[k].as_u64().unwrap_or(0);let o=old_prefix[k].as_u64().unwrap_or(0);let n=new_prefix[k].as_u64().unwrap_or(0);result[k]=json!(f.checked_sub(o).and_then(|v|v.checked_add(n)).ok_or("Convergence counter underflow")?);}Ok(result)
}
#[cfg(test)]mod tests{use super::*;#[test]fn corrected_prefix_is_never_reintroduced(){assert_eq!(counts(&json!({"rows":9}),&json!({"rows":4}),&json!({"rows":3})).unwrap()["rows"],8);assert_eq!(summaries(&json!({"2015-01-01":[4],"2015-02-01":[5]}),&json!({"2015-01-01":[3]}),"2015-01").unwrap(),json!({"2015-01-01":[3],"2015-02-01":[5]}));assert!(!same_inputs_after(&json!({"2015-01":"old","2015-03":"a"}),&json!({"2015-01":"new","2015-03":"b"}),"2015-02"));assert!(counts(&json!({"rows":2}),&json!({"rows":4}),&json!({"rows":0})).is_err());}}
