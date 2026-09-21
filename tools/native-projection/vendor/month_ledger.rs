//! Transactional month ledgers compatible with trade_month_ledger.py.
//! Mutators use the caller's transaction. Readers never repair or initialize state.
use crate::Result;
use rusqlite::{params, types::ValueRef, Connection, OptionalExtension, OpenFlags};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

const VERSION: &str = "2";
const FIELDS: [&str; 13] = ["apt_seq", "area", "year", "month", "contract_day", "price", "floor", "dealing_type", "source_lawd_cd", "source_deal_ymd", "source_page_no", "source_item_no", "detail_fingerprint"];

fn ident(name: &str) -> Result<&str> {
    if name.is_empty() || !name.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_') { return Err("Invalid SQL identifier".into()); }
    Ok(name)
}
fn packed(v: &Value) -> Result<Vec<u8>> { crate::rental::packed(v) }
fn compact(v: &Value) -> Result<String> { Ok(String::from_utf8(packed(v)?)?) }
fn tables(missing: bool) -> &'static [&'static str] { if missing { &["disappeared_transactions"] } else { &["transactions", "cancelled_transactions"] } }
fn value(v: ValueRef<'_>) -> Result<Value> {
    Ok(match v { ValueRef::Null => Value::Null, ValueRef::Integer(i) => json!(i),
        ValueRef::Real(f) if f.is_finite() => json!(f), ValueRef::Text(s) => json!(std::str::from_utf8(s)?),
        _ => return Err("Unsupported or nonfinite ledger value".into()) })
}
fn row_values(row: &rusqlite::Row<'_>, count: usize) -> Result<Vec<Value>> {
    (0..count).map(|i| value(row.get_ref(i)?)).collect()
}
fn columns(c: &Connection, table: &str, schema: &str) -> Result<Vec<String>> {
    let mut q = c.prepare(&format!("PRAGMA {}.table_info({})", ident(schema)?, ident(table)?))?;
    let result = q.query_map([], |r| r.get(1))?.collect::<std::result::Result<_, _>>()?; Ok(result)
}
pub fn meta(c: &Connection, schema: &str) -> Result<BTreeMap<String,String>> {
    let mut q = match c.prepare(&format!("SELECT key,value FROM {}.month_ledger_meta", ident(schema)?)) { Ok(q) => q, Err(_) => return Ok(BTreeMap::new()) };
    let result = q.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<std::result::Result<_,_>>()?; Ok(result)
}
fn put(c: &Connection, key: &str, v: &str, schema: &str) -> Result<()> {
    c.execute(&format!("INSERT OR REPLACE INTO {}.month_ledger_meta VALUES(?,?)", ident(schema)?), params![key,v])?; Ok(())
}
fn triggers(c: &Connection, schema: &str, prefix: &str) -> Result<Vec<(String,String)>> {
    let mut q = c.prepare(&format!("SELECT name,sql FROM {}.sqlite_master WHERE type='trigger' AND name LIKE ? ORDER BY name", ident(schema)?))?;
    let result = q.query_map([format!("{prefix}_%")], |r| Ok((r.get(0)?,r.get(1)?)))?.collect::<std::result::Result<_,_>>()?; Ok(result)
}
pub fn trigger_signature(c: &Connection, schema: &str, prefix: &str) -> Result<String> {
    Ok(format!("{:x}", Sha256::digest(packed(&json!(triggers(c,schema,prefix)?))?)))
}
fn names(c: &Connection, schema: &str, prefix: &str) -> Result<BTreeSet<String>> {
    Ok(triggers(c,schema,prefix)?.into_iter().map(|v| v.0).collect())
}
pub fn install(c: &Connection, schema: &str, missing: bool) -> Result<()> {
    let schema=ident(schema)?;
    for table in tables(missing) {
        let cols=columns(c,table,schema)?;
        if FIELDS.iter().any(|v|!cols.iter().any(|s|s==v)) { return Err("Monthly ledger requires complete projection columns".into()); }
    }
    c.execute_batch(&format!("CREATE TABLE IF NOT EXISTS {schema}.month_ledger_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS {schema}.month_ledger(kind TEXT,region TEXT,year INT,month INT,digest TEXT,rows INT,PRIMARY KEY(kind,region,year,month));
CREATE TABLE IF NOT EXISTS {schema}.month_ledger_dirty(kind TEXT,year INT,month INT,PRIMARY KEY(kind,year,month));"))?;
    let old=meta(c,schema)?;
    let expected:BTreeSet<_>=tables(missing).iter().flat_map(|t|["insert","delete","update"].map(move |op|format!("ml_{t}_{op}"))).collect();
    let actual=names(c,schema,"ml")?;
    if old.get("version").map(String::as_str)==Some(VERSION) && old.get("triggers")==Some(&trigger_signature(c,schema,"ml")?) && actual==expected { return Ok(()); }
    put(c,"complete","0",schema)?; put(c,"version",VERSION,schema)?; put(c,"epoch",&uuid::Uuid::new_v4().simple().to_string(),schema)?;
    for name in actual { c.execute_batch(&format!("DROP TRIGGER {schema}.\"{}\"",ident(&name)?))?; }
    for table in tables(missing) {
        c.execute_batch(&format!("CREATE INDEX IF NOT EXISTS {schema}.ml_{table}_ym ON {table}(year,month)"))?;
        for op in ["insert","delete","update"] {
            let refs:&[&str]=match op { "update"=>&["OLD","NEW"], "insert"=>&["NEW"], _=>&["OLD"] };
            let body=refs.iter().map(|r|format!("INSERT OR IGNORE INTO month_ledger_dirty VALUES('{table}',COALESCE({r}.year,0),COALESCE({r}.month,0));")).collect::<String>();
            let condition=if op=="update" { let mut fields=FIELDS.to_vec(); if missing {fields.push("source_state");} format!(" WHEN {}",fields.iter().map(|f|format!("OLD.{f} IS NOT NEW.{f}")).collect::<Vec<_>>().join(" OR ")) } else {String::new()};
            c.execute_batch(&format!("CREATE TRIGGER {schema}.ml_{table}_{op} AFTER {} ON {table}{condition} BEGIN {body} END",op.to_uppercase()))?;
        }
    }
    put(c,"triggers",&trigger_signature(c,schema,"ml")?,schema)
}
pub fn trusted(c: &Connection, schema: &str) -> Result<bool> {
    let m=meta(c,schema)?;
    if m.get("version").map(String::as_str)!=Some(VERSION) || m.get("complete").map(String::as_str)!=Some("1") || m.get("triggers")!=Some(&trigger_signature(c,schema,"ml")?) { return Ok(false); }
    Ok(c.query_row(&format!("SELECT 1 FROM {}.month_ledger_dirty LIMIT 1",ident(schema)?),[],|r|r.get::<_,i64>(0)).optional()?.is_none())
}
fn region(row: &[Value]) -> String {
    match &row[8] { Value::Null=>String::new(), Value::String(v)=>v.clone(), other=>other.to_string() }
}
pub fn refresh(c: &Connection, schema: &str, missing: bool, force: bool, months: &[(i64,i64)]) -> Result<Value> {
    install(c,schema,missing)?;
    let full=force || meta(c,schema)?.get("complete").map(String::as_str)!=Some("1");
    let mut dirty:BTreeSet<(String,i64,i64)>=c.prepare(&format!("SELECT kind,year,month FROM {schema}.month_ledger_dirty"))?.query_map([],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?.collect::<std::result::Result<_,_>>()?;
    for &(y,m) in months {for table in tables(missing){dirty.insert((table.to_string(),y,m));}}
    if full {
        for table in tables(missing) {
            let mut q=c.prepare(&format!("SELECT DISTINCT COALESCE(year,0),COALESCE(month,0) FROM {schema}.{table}"))?;
            for row in q.query_map([],|r|Ok((r.get::<_,i64>(0)?,r.get::<_,i64>(1)?)))? {let (y,m)=row?;dirty.insert((table.to_string(),y,m));}
        }
        dirty.extend(c.prepare(&format!("SELECT DISTINCT kind,year,month FROM {schema}.month_ledger"))?.query_map([],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?.collect::<std::result::Result<Vec<_>,_>>()?);
    }
    for (table,y,m) in &dirty {
        if !tables(missing).contains(&table.as_str()) {return Err("Unknown ledger kind".into());}
        let mut where_clause=if *y!=0 && *m!=0 {"year=? AND month=?".to_string()} else {"COALESCE(year,0)=? AND COALESCE(month,0)=?".to_string()};
        if missing {where_clause.push_str(" AND source_state='missing'");}
        let fields=FIELDS.join(",");
        let mut q=c.prepare(&format!("SELECT {fields} FROM {schema}.{table} WHERE {where_clause} ORDER BY {fields}"))?;
        let mut rows=q.query(params![y,m])?;let mut hashes:BTreeMap<String,(Sha256,i64)>=BTreeMap::new();
        while let Some(row)=rows.next()? {let values=row_values(row,FIELDS.len())?;let state=hashes.entry(region(&values)).or_default();state.0.update(packed(&json!(values))?);state.0.update(b"\n");state.1+=1;}
        c.execute(&format!("DELETE FROM {schema}.month_ledger WHERE kind=? AND year=? AND month=?"),params![table,y,m])?;
        for (r,(h,n)) in hashes {c.execute(&format!("INSERT INTO {schema}.month_ledger VALUES(?,?,?,?,?,?)"),params![table,r,y,m,format!("{:x}",h.finalize()),n])?;}
    }
    c.execute(&format!("DELETE FROM {schema}.month_ledger_dirty"),[])?;put(c,"complete","1",schema)?;
    Ok(json!({"full":full,"partitions":dirty.len()}))
}
pub fn read(c: &Connection, schema: &str) -> Result<Value> {
    if !trusted(c,schema)? {return Ok(Value::Null);}
    let mut result=Map::new();let mut q=c.prepare(&format!("SELECT * FROM {}.month_ledger ORDER BY kind,region,year,month",ident(schema)?))?;let mut rows=q.query([])?;
    while let Some(r)=rows.next()? {let kind:String=r.get(0)?;let region:String=r.get(1)?;let y:i64=r.get(2)?;let m:i64=r.get(3)?;result.insert(compact(&json!([kind,region,y,m]))?,json!({"month":y*100+m,"hash":r.get::<_,String>(4)?,"rows":r.get::<_,i64>(5)?}));}
    Ok(Value::Object(result))
}
pub fn install_source(c: &Connection) -> Result<()> {
    let before=trigger_signature(c,"main","pv2")?;
    let expected:Option<String>=c.query_row("SELECT value FROM snapshot_meta WHERE key='partition_v2_triggers'",[],|r|r.get(0)).optional()?;
    if expected.as_ref()!=Some(&before) {for name in names(c,"main","pv2")? {c.execute_batch(&format!("DROP TRIGGER \"{}\"",ident(&name)?))?;}}
    c.execute_batch("CREATE TABLE IF NOT EXISTS partition_content_hash_v2(property_type TEXT,lawd_cd TEXT,deal_ymd TEXT,digest TEXT,months TEXT,rows INT,PRIMARY KEY(property_type,lawd_cd,deal_ymd));CREATE TABLE IF NOT EXISTS partition_dirty_v2(property_type TEXT,lawd_cd TEXT,deal_ymd TEXT,PRIMARY KEY(property_type,lawd_cd,deal_ymd));")?;
    for table in ["api_trade","api_trade_exclusion"] {for op in ["insert","delete","update"] {
        let refs:&[&str]=match op {"update"=>&["OLD","NEW"],"insert"=>&["NEW"],_=>&["OLD"]};
        let body=refs.iter().map(|r|format!("INSERT OR IGNORE INTO partition_dirty_v2 VALUES({r}.property_type,{r}.lawd_cd,{r}.deal_ymd);")).collect::<String>();
        c.execute_batch(&format!("CREATE TRIGGER IF NOT EXISTS pv2_{table}_{op} AFTER {} ON {table} BEGIN {body} END",op.to_uppercase()))?;
    }}
    let current=trigger_signature(c,"main","pv2")?;
    if expected.as_ref()!=Some(&before) || before!=current {c.execute("INSERT OR REPLACE INTO snapshot_meta VALUES('partition_v2_complete','0')",[])?;}
    c.execute("INSERT OR REPLACE INTO snapshot_meta VALUES('partition_v2_triggers',?)",[current])?;Ok(())
}
pub fn source_manifest(c: &Connection, schema: &str) -> Result<Value> {
    let attempt=(||->Result<Value>{
        let schema=ident(schema)?;
        let complete:Option<String>=c.query_row(&format!("SELECT value FROM {schema}.snapshot_meta WHERE key='partition_v2_complete'"),[],|r|r.get(0)).optional()?;
        let signature:Option<String>=c.query_row(&format!("SELECT value FROM {schema}.snapshot_meta WHERE key='partition_v2_triggers'"),[],|r|r.get(0)).optional()?;
        let expected:BTreeSet<_>=["api_trade","api_trade_exclusion"].iter().flat_map(|t|["insert","delete","update"].map(move|op|format!("pv2_{t}_{op}"))).collect();
        if complete.as_deref()!=Some(VERSION) || names(c,schema,"pv2")?!=expected || signature!=Some(trigger_signature(c,schema,"pv2")?) {return Ok(Value::Null);}
        if c.query_row(&format!("SELECT 1 FROM {schema}.partition_dirty_v2 LIMIT 1"),[],|r|r.get::<_,i64>(0)).optional()?.is_some(){return Ok(Value::Null);}
        let mut q=c.prepare(&format!("SELECT * FROM {schema}.partition_content_hash_v2 ORDER BY property_type,lawd_cd,deal_ymd"))?;let mut rows=q.query([])?;let mut result=Map::new();
        while let Some(r)=rows.next()? {result.insert(compact(&json!([r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?]))?,json!({"hash":r.get::<_,String>(3)?,"months":serde_json::from_str::<Value>(&r.get::<_,String>(4)?)?,"rows":r.get::<_,i64>(5)?}));}
        Ok(Value::Object(result))
    })();
    match attempt {Ok(v)=>Ok(v),Err(e) if e.downcast_ref::<rusqlite::Error>().is_some()=>Ok(Value::Null),Err(e)=>Err(e)}
}
type SourceKey=(String,String,String);
fn source_keys(c: &Connection) -> Result<BTreeSet<SourceKey>> {
    let mut keys=BTreeSet::new();
    for table in ["fetch_status","api_trade","api_trade_exclusion","partition_content_hash_v2"] {
        keys.extend(c.prepare(&format!("SELECT DISTINCT property_type,lawd_cd,deal_ymd FROM {table}"))?.query_map([],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?.collect::<std::result::Result<Vec<_>,_>>()?);
    } Ok(keys)
}
pub fn source_partition_value(c: &Connection,key:&SourceKey)->Result<(String,String,i64)> {
    let mut hash=Sha256::new();let mut months=BTreeSet::new();let mut count=0;
    for table in ["api_trade","api_trade_exclusion"] {
        let fields:Vec<_>=columns(c,table,"main")?.into_iter().filter(|v|!["trade_id","fetched_at","run_id","excluded_at"].contains(&v.as_str())).collect();
        for f in &fields {ident(f)?;}
        let names=fields.join(",");let mut q=c.prepare(&format!("SELECT {names} FROM {table} WHERE property_type=? AND lawd_cd=? AND deal_ymd=? ORDER BY {names}"))?;
        let mut rows=q.query(params![key.0,key.1,key.2])?;
        while let Some(r)=rows.next()? {
            let values=row_values(r,fields.len())?;
            if table=="api_trade" {
                let number=|key:&str|->Result<i64>{let pos=fields.iter().position(|v|v==key).ok_or("Missing contract month column")?;Ok(values[pos].as_i64().unwrap_or(0))};
                months.insert(number("contract_year")?*100+number("contract_month")?);
            }
            let mut line=vec![json!(table)];line.extend(values);hash.update(packed(&json!(line))?);hash.update(b"\n");count+=1;
        }
    }
    Ok((format!("{:x}",hash.finalize()),format!("[{}]",months.iter().map(i64::to_string).collect::<Vec<_>>().join(", ")),count))
}
pub fn refresh_source(c: &Connection, force: bool)->Result<Value> {
    install_source(c)?;
    let ready:Option<String>=c.query_row("SELECT value FROM snapshot_meta WHERE key='partition_v2_complete'",[],|r|r.get(0)).optional()?;
    let full=force||ready.as_deref()!=Some(VERSION);
    let mut keys:BTreeSet<SourceKey>=c.prepare("SELECT * FROM partition_dirty_v2")?.query_map([],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?.collect::<std::result::Result<_,_>>()?;
    if full {keys.extend(source_keys(c)?);}
    let mut changed=0;
    for key in &keys {
        let v=source_partition_value(c,key)?;
        let old:Option<(String,String,i64)>=c.query_row("SELECT digest,months,rows FROM partition_content_hash_v2 WHERE property_type=? AND lawd_cd=? AND deal_ymd=?",params![key.0,key.1,key.2],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional()?;
        if old.as_ref()!=Some(&v) {c.execute("INSERT OR REPLACE INTO partition_content_hash_v2 VALUES(?,?,?,?,?,?)",params![key.0,key.1,key.2,v.0,v.1,v.2])?;changed+=1;}
    }
    c.execute("DELETE FROM partition_dirty_v2",[])?;
    c.execute("INSERT OR REPLACE INTO snapshot_meta VALUES('partition_v2_complete',?)",[VERSION])?;
    if changed>0 {c.execute("INSERT OR REPLACE INTO snapshot_meta VALUES('content_revision',?)",[uuid::Uuid::new_v4().simple().to_string()])?;}
    Ok(json!({"full":full,"partitions":keys.len(),"changed":changed}))
}
pub fn audit_source(c:&Connection)->Result<Value> {
    let known=source_manifest(c,"main")?;if known.is_null(){return Ok(json!({"status":"untrusted"}));}
    let keys=source_keys(c)?;let mut mismatches=Vec::new();
    for key in &keys {let(h,m,n)=source_partition_value(c,key)?;let k=compact(&json!(key))?;if known[&k]!=json!({"hash":h,"months":serde_json::from_str::<Value>(&m)?,"rows":n}){mismatches.push(key);}}
    Ok(json!({"status":if mismatches.is_empty(){"pass"}else{"fail"},"partitions":keys.len(),"mismatches":mismatches}))
}
pub fn audit(c:&Connection,schema:&str,missing:bool)->Result<Value> {
    let known=read(c,schema)?;if known.is_null(){return Ok(json!({"status":"untrusted"}));}
    let mut actual=Map::new();
    for table in tables(missing) {
        let condition=if missing{" WHERE source_state='missing'"}else{""};let fields=FIELDS.join(",");
        let mut q=c.prepare(&format!("SELECT {fields} FROM {}.{table}{condition} ORDER BY {fields}",ident(schema)?))?;let mut rows=q.query([])?;let mut hashes:BTreeMap<String,(Sha256,i64,i64)>=BTreeMap::new();
        while let Some(r)=rows.next()? {let row=row_values(r,FIELDS.len())?;let y=row[2].as_i64().unwrap_or(0);let m=row[3].as_i64().unwrap_or(0);let key=compact(&json!([table,region(&row),y,m]))?;let v=hashes.entry(key).or_default();v.0.update(packed(&json!(row))?);v.0.update(b"\n");v.1+=1;v.2=y*100+m;}
        for(k,(h,n,m))in hashes {actual.insert(k,json!({"month":m,"hash":format!("{:x}",h.finalize()),"rows":n}));}
    }
    let all:BTreeSet<_>=known.as_object().unwrap().keys().chain(actual.keys()).collect();
    let mismatches:Vec<_>=all.into_iter().filter(|k|known.get(*k)!=actual.get(*k)).collect();
    Ok(json!({"status":if mismatches.is_empty(){"pass"}else{"fail"},"partitions":actual.len(),"mismatches":mismatches}))
}
pub fn run(spec:Value)->Result<Value> {
    let action=spec["action"].as_str().ok_or("Ledger action required")?;
    if action=="changed-months" {return changed_months(&spec["old"],&spec["new"]);}
    let write=matches!(action,"refresh"|"source-refresh");
    let _lock=if write {crate::pipeline_guard::check(&spec,"collection")?;let root=crate::pipeline_guard::root(&spec)?;Some(crate::pipeline_guard::WriterLock::acquire(&root.join("_ops/trade-api-transition/pipeline.lock"))?)}else{None};
    if write {crate::pipeline_guard::check(&spec,"collection")?;}
    let c=Connection::open_with_flags(spec["database"].as_str().ok_or("Ledger database required")?,if write{OpenFlags::SQLITE_OPEN_READ_WRITE}else{OpenFlags::SQLITE_OPEN_READ_ONLY})?;
    c.busy_timeout(std::time::Duration::from_secs(60))?;
    if !write {c.pragma_update(None,"query_only",true)?;}
    c.execute_batch(if write{"BEGIN IMMEDIATE"}else{"BEGIN"})?;
    let missing=spec["missing"].as_bool().unwrap_or(false);let force=spec["force"].as_bool().unwrap_or(false);
    let result=match action {
        "read"=>read(&c,"main"),"audit"=>audit(&c,"main",missing),
        "source-read"=>source_manifest(&c,"main"),"source-audit"=>audit_source(&c),
        "source-refresh"=>refresh_source(&c,force),
        "refresh"=>{let months:Vec<(i64,i64)>=serde_json::from_value(spec.get("months").cloned().unwrap_or(json!([])))?;refresh(&c,"main",missing,force,&months)},
        _=>Err("Unknown ledger action".into()),
    }?;
    c.execute_batch("COMMIT")?;Ok(result)
}

pub fn changed_months(old:&Value,new:&Value)->Result<Value>{
    if old.is_null()||new.is_null(){return Ok(Value::Null);}
    let old=old.as_object().ok_or("Invalid old source manifest")?;
    let new=new.as_object().ok_or("Invalid new source manifest")?;
    let keys:BTreeSet<_>=old.keys().chain(new.keys()).collect();
    let mut months=BTreeSet::new();
    for key in keys {
        let parsed:Value=serde_json::from_str(key)?;
        if parsed[0]!="apartment"||old.get(key)==new.get(key){continue;}
        for value in [old.get(key),new.get(key)].into_iter().flatten(){
            for month in value["months"].as_array().ok_or("Invalid source months")? {
                let m=match month{Value::String(s)=>s.parse::<i64>()?,_=>month.as_i64().ok_or("Invalid source month")?};
                months.insert((m.div_euclid(100),m.rem_euclid(100)));
            }
        }
    }
    Ok(json!(months))
}
