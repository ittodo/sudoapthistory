//! Streaming exact-area daily sales, with verified content-addressed month checkpoints.
use crate::{rental::packed, Result};
use chrono::{Local, NaiveDate, Utc};
use flate2::{read::GzDecoder, Compression, GzBuilder};
use rusqlite::{params_from_iter, types::ValueRef, Connection, OpenFlags, Row};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};
const FIELDS: &str="apt_seq,area,year,month,contract_day,price,floor,dealing_type,source_lawd_cd,source_deal_ymd,source_page_no,source_item_no,detail_fingerprint";
const ORDER: &str=" ORDER BY year,month,contract_day,apt_seq,area,price,floor,source_page_no,source_item_no,source_lawd_cd,source_deal_ymd,detail_fingerprint,inactive";
fn hash(b: &[u8]) -> String {
    format!("{:x}", Sha256::digest(b))
}
fn obj() -> Value {
    Value::Object(Map::new())
}
fn strv(v: &Value) -> Result<&str> {
    v.as_str().ok_or("Expected string".into())
}
fn arr(v: &Value) -> Result<&Vec<Value>> {
    v.as_array().ok_or("Expected array".into())
}
fn map(v: &Value) -> Result<&Map<String, Value>> {
    v.as_object().ok_or("Expected object".into())
}
fn num(v: &Value) -> Result<f64> {
    v.as_f64().ok_or("Expected number".into())
}
fn path(spec: &Value, key: &str) -> Result<PathBuf> {
    Ok(PathBuf::from(strv(&spec[key])?))
}
fn optional_path(spec: &Value, key: &str) -> Option<PathBuf> {
    spec[key]
        .as_str()
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
}
fn read(p: &Path) -> Result<Value> {
    Ok(serde_json::from_slice(&fs::read(p)?)?)
}
fn digest(p: &Path) -> Result<String> {
    let mut file = fs::File::open(p)?;
    let mut h = Sha256::new();
    let mut b = [0u8; 65536];
    loop {
        let n = file.read(&mut b)?;
        if n == 0 {
            break;
        }
        h.update(&b[..n]);
    }
    Ok(format!("{:x}", h.finalize()))
}
fn gzip(raw: &[u8], level: u32) -> Result<Vec<u8>> {
    let mut enc = GzBuilder::new()
        .mtime(0)
        .operating_system(255)
        .write(Vec::new(), Compression::new(level));
    enc.write_all(raw)?;
    Ok(enc.finish()?)
}
fn ungzip(raw: &[u8]) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    GzDecoder::new(raw).read_to_end(&mut bytes)?;
    Ok(bytes)
}
fn atomic(path: &Path, raw: &[u8]) -> Result<()> {
    fs::create_dir_all(path.parent().ok_or("No parent")?)?;
    let tmp = path.with_file_name(format!(
        "{}.{}.tmp",
        path.file_name().ok_or("No filename")?.to_string_lossy(),
        uuid::Uuid::new_v4().simple()
    ));
    fs::write(&tmp, raw)?;
    fs::rename(tmp, path)?;
    Ok(())
}
fn safe(root: &Path, name: &str) -> Result<PathBuf> {
    crate::apartment_rent::safe(root, name)
}
fn daily_name(name: &str) -> Result<()> {
    if !name.starts_with("data/daily/")
        || !name.ends_with(".bin")
        || name.contains(['\\', ':'])
        || name
            .split('/')
            .any(|s| s == ".." || s == "." || s.is_empty())
    {
        return Err("Unsafe cache artifact".into());
    }
    Ok(())
}
fn absolute_name(p: &Path) -> Result<String> {
    Ok(p.canonicalize()?
        .to_string_lossy()
        .trim_start_matches("\\\\?\\")
        .to_owned())
}
fn sqlite_row(row: &Row<'_>) -> Result<Value> {
    let mut a = Vec::new();
    for i in 0..14 {
        a.push(match row.get_ref(i)? {
            ValueRef::Null => Value::Null,
            ValueRef::Integer(n) => json!(n),
            ValueRef::Real(n) => json!(n),
            ValueRef::Text(s) => json!(std::str::from_utf8(s)?),
            ValueRef::Blob(_) => return Err("Unexpected blob in sale projection".into()),
        });
    }
    Ok(json!(a))
}
fn metas(c: &Connection) -> Result<Value> {
    let mut v = obj();
    let mut q = c.prepare("SELECT key,value FROM build_meta")?;
    let mut rows = q.query([])?;
    while let Some(r) = rows.next()? {
        v[r.get::<_, String>(0)?] = json!(r.get::<_, String>(1)?)
    }
    Ok(v)
}
fn ledgers(c: &Connection, missing: bool) -> Result<Value> {
    let mut result = obj();
    for schema in if missing {
        vec!["main", "gone"]
    } else {
        vec!["main"]
    } {
        let v = crate::month_ledger::read(c, schema)?;
        if v.is_null() {
            return Ok(Value::Null);
        }
        for (k, v) in map(&v)? {
            result[format!("{schema}:{k}")] = v.clone()
        }
    }
    Ok(result)
}

struct MonthCache {
    root: PathBuf,
    context: String,
    ledger: Value,
    today: String,
    entries: Value,
    old: Value,
    reason: String,
    restored: Option<String>,
}
impl MonthCache {
    fn new(root: PathBuf, context: String, ledger: Value, today: String) -> Self {
        let mut reason = "no-valid-state".to_owned();
        let old = read(&root.join("index.json"))
            .ok()
            .filter(|v| {
                let valid = v["schema"] == 2 && v["context"] == context && v["safeDates"] == true;
                if !valid {
                    reason = "context-or-date-policy-changed".into()
                }
                valid
            })
            .unwrap_or(Value::Null);
        Self {
            root,
            context,
            ledger,
            today,
            entries: obj(),
            old,
            reason,
            restored: None,
        }
    }
    fn blob(&self, raw: &[u8]) -> Result<String> {
        let key = hash(raw);
        let p = self.root.join("objects").join(&key);
        if digest(&p).ok().as_deref() != Some(&key) {
            atomic(&p, raw)?
        }
        Ok(key)
    }
    fn get(&self, key: &Value) -> Result<Vec<u8>> {
        let key = strv(key)?;
        if key.len() != 64
            || !key
                .bytes()
                .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
        {
            return Err("Invalid cache object".into());
        }
        let raw = fs::read(self.root.join("objects").join(key))?;
        if hash(&raw) != key {
            return Err("Corrupt cache object".into());
        }
        Ok(raw)
    }
    fn restore_one(&self, month: &str, site: &Path) -> Result<Value> {
        let state: Value =
            serde_json::from_slice(&ungzip(&self.get(&self.old["states"][month])?)?)?;
        for (name, key) in map(&state["files"])? {
            daily_name(name)?;
            let raw = self.get(key)?;
            let p = safe(site, name)?;
            if fs::read(&p).ok().as_deref() != Some(&raw) {
                atomic(&p, &raw)?
            }
        }
        Ok(state)
    }
    fn restore(&mut self, site: &Path) -> Result<Option<Value>> {
        if self.old.is_null() {
            return Ok(None);
        }
        let keys: BTreeSet<&String> = map(&self.old["ledger"])?
            .keys()
            .chain(map(&self.ledger)?.keys())
            .collect();
        let mut earliest = 999999i64;
        let mut changed = false;
        for k in keys {
            if self.old["ledger"][k] != self.ledger[k] {
                changed = true;
                for v in [&self.old["ledger"][k], &self.ledger[k]] {
                    if !v.is_null() {
                        earliest = earliest.min(v["month"].as_i64().ok_or("Invalid ledger month")?)
                    }
                }
            }
        }
        let mut candidates: Vec<String> = map(&self.old["states"])?
            .keys()
            .filter(|m| {
                m.replace('-', "")
                    .parse::<i64>()
                    .is_ok_and(|m| m < earliest)
            })
            .cloned()
            .collect();
        candidates.sort();
        candidates.reverse();
        for month in candidates {
            match self.restore_one(&month, site) {
                Ok(state) => {
                    for (m, key) in map(&self.old["states"])? {
                        if m <= &month {
                            self.entries[m] = key.clone()
                        }
                    }
                    self.restored = Some(month);
                    self.reason = if changed {
                        "changed-month"
                    } else {
                        "unchanged"
                    }
                    .into();
                    return Ok(Some(state));
                }
                Err(_) => self.reason = "damaged-state".into(),
            }
        }
        Ok(None)
    }
    fn capture(&mut self, month: &str, state: &[u8], files: &Value, site: &Path) -> Result<()> {
        for (name, key) in map(files)? {
            if name
                .rsplit('/')
                .next()
                .is_some_and(|s| s.starts_with(month))
            {
                let raw = fs::read(safe(site, name)?)?;
                if Some(hash(&raw).as_str()) != key.as_str() {
                    return Err("Output changed while caching".into());
                }
                self.blob(&raw)?;
            }
        }
        self.entries[month] = json!(self.blob(&gzip(state, 1)?)?);
        Ok(())
    }
    fn commit(&self, counts: &Value) -> Result<()> {
        atomic(
            &self.root.join("index.json"),
            &packed(
                &json!({"schema":2,"context":self.context,"ledger":self.ledger,"asOfDate":self.today,"safeDates":counts["invalidDate"].as_i64().unwrap_or(0)==0&&counts["futureDate"].as_i64().unwrap_or(0)==0,"states":self.entries}),
            )?,
        )
    }
}

struct Builder {
    site: PathBuf,
    previous: PathBuf,
    previous_index: Value,
    complexes: Vec<Value>,
    by_source: BTreeMap<String, usize>,
    areas: Vec<Value>,
    area_ids: BTreeMap<(usize, String), usize>,
    history: Value,
    states: Vec<Value>,
    files: Value,
    summaries: Value,
    months: Vec<String>,
    counts: Value,
    current: Option<String>,
    rows: Vec<Vec<Value>>,
    updates: Vec<Vec<Value>>,
    opening: Vec<Vec<Value>>,
    min: Option<String>,
    max: Option<String>,
    monthly: Option<MonthCache>,
    reused: usize,
    compressed: usize,
    written: usize,
    unchanged: usize,
}
impl Builder {
    fn snapshot(&self) -> Value {
        json!({"areas":self.areas,"history":self.history,"states":self.states,"counts":self.counts,"summaries":self.summaries,"months":self.months,"files":self.files,"minDate":self.min,"maxDate":self.max,"currentMonth":self.current})
    }
    // Serialize borrowed state without cloning every area's price history each month.
    fn snapshot_bytes(&self) -> Result<Vec<u8>> {
        fn array(values: &[Value], out: &mut Vec<u8>) -> Result<()> {
            out.push(b'[');
            for (i, value) in values.iter().enumerate() {
                if i > 0 {
                    out.push(b',');
                }
                out.extend(packed(value)?);
            }
            out.push(b']');
            Ok(())
        }
        let mut out = b"{\"areas\":".to_vec();
        array(&self.areas, &mut out)?;
        out.extend(b",\"history\":");
        out.extend(packed(&self.history)?);
        out.extend(b",\"states\":");
        array(&self.states, &mut out)?;
        for (key, value) in [("counts", &self.counts), ("summaries", &self.summaries)] {
            out.extend(format!(",\"{key}\":").as_bytes());
            out.extend(packed(value)?);
        }
        out.extend(b",\"months\":");
        out.extend(packed(&json!(self.months))?);
        out.extend(b",\"files\":");
        out.extend(packed(&self.files)?);
        for (key, value) in [
            ("minDate", &self.min),
            ("maxDate", &self.max),
            ("currentMonth", &self.current),
        ] {
            out.extend(format!(",\"{key}\":").as_bytes());
            out.extend(packed(&json!(value))?);
        }
        out.push(b'}');
        Ok(out)
    }
    fn restore(&mut self, state: Value) -> Result<()> {
        self.areas = arr(&state["areas"])?.clone();
        self.area_ids = self
            .areas
            .iter()
            .enumerate()
            .map(|(i, v)| {
                Ok((
                    (
                        v[0].as_u64().ok_or("Invalid area ID")? as usize,
                        strv(&v[1])?.to_owned(),
                    ),
                    i,
                ))
            })
            .collect::<Result<_>>()?;
        self.history = state["history"].clone();
        self.states = arr(&state["states"])?.clone();
        if self.states.len() != 3 {
            return Err("Invalid region states".into());
        }
        self.counts = state["counts"].clone();
        self.summaries = state["summaries"].clone();
        self.months = arr(&state["months"])?
            .iter()
            .map(|v| Ok(strv(v)?.to_owned()))
            .collect::<Result<_>>()?;
        self.files = state["files"].clone();
        self.min = state["minDate"].as_str().map(str::to_owned);
        self.max = state["maxDate"].as_str().map(str::to_owned);
        self.current = state["currentMonth"].as_str().map(str::to_owned);
        Ok(())
    }
    fn write(&mut self, relative: &str, value: &Value) -> Result<()> {
        let compressed = relative != "data/daily/index.json";
        let relative = if compressed {
            format!("{}.bin", relative.strip_suffix(".json").unwrap_or(relative))
        } else {
            relative.to_owned()
        };
        let mut content = packed(value)?;
        if compressed {
            let previous = safe(&self.previous, &relative)?;
            let candidate = fs::read(previous).ok().filter(|b| {
                Some(hash(b).as_str()) == self.previous_index["sources"][&relative].as_str()
                    && ungzip(b).is_ok_and(|b| b == content)
            });
            if let Some(raw) = candidate {
                content = raw;
                self.reused += 1
            } else {
                content = gzip(&content, 6)?;
                self.compressed += 1
            }
        }
        if content.len() > 24 * 1024 * 1024 {
            return Err(format!("Daily shard exceeds size budget: {relative}").into());
        }
        let p = safe(&self.site, &relative)?;
        if fs::read(&p).ok().as_deref() == Some(&content) {
            self.unchanged += 1
        } else {
            atomic(&p, &content)?;
            self.written += 1
        }
        self.files[relative] = json!(hash(&content));
        Ok(())
    }
    fn flush(&mut self) -> Result<()> {
        let Some(month) = self.current.clone() else {
            return Ok(());
        };
        if self.months.last() == Some(&month) {
            return Ok(());
        }
        self.months.push(month.clone());
        for region in 0..3 {
            let mut rows = Map::new();
            rows.insert(
                "rows".into(),
                Value::Array(std::mem::take(&mut self.rows[region])),
            );
            self.write(
                &format!("data/daily/{region}/{month}.json"),
                &Value::Object(rows),
            )?;
            let mut state = Map::new();
            state.insert(
                "opening".into(),
                Value::Array(std::mem::take(&mut self.opening[region])),
            );
            state.insert(
                "updates".into(),
                Value::Array(std::mem::take(&mut self.updates[region])),
            );
            self.write(
                &format!("data/daily/{region}/{month}-state.json"),
                &Value::Object(state),
            )?;
        }
        if self.monthly.is_some() {
            let snapshot = self.snapshot_bytes()?;
            self.monthly
                .as_mut()
                .unwrap()
                .capture(&month, &snapshot, &self.files, &self.site)?;
        }
        Ok(())
    }
    fn begin_month(&mut self, month: String) -> Result<()> {
        self.current = Some(month);
        self.rows = vec![Vec::new(); 3];
        self.updates = vec![Vec::new(); 3];
        self.opening = self
            .states
            .iter()
            .map(|s| Ok(map(s)?.values().cloned().collect()))
            .collect::<Result<_>>()?;
        Ok(())
    }
    fn increment(&mut self, key: &str, by: usize) {
        let current = self.counts[key].as_u64().unwrap_or(0);
        self.counts[key] = json!(current + by as u64)
    }
    fn day(&mut self, parts: &[Value], records: &[Value], today: &str) -> Result<usize> {
        let parsed = (|| {
            let y = i32::try_from(parts[0].as_i64()?).ok()?;
            let m = u32::try_from(parts[1].as_i64()?).ok()?;
            let d = u32::try_from(parts[2].as_i64()?).ok()?;
            if !(1..=9999).contains(&y) {
                return None;
            }
            NaiveDate::from_ymd_opt(y, m, d)
        })();
        let Some(date) = parsed else {
            self.increment("invalidDate", records.len());
            return Ok(0);
        };
        let iso = date.format("%Y-%m-%d").to_string();
        if iso.as_str() > today {
            self.increment("futureDate", records.len());
            return Ok(0);
        }
        let month = &iso[..7];
        if self.current.as_deref() != Some(month) {
            self.flush()?;
            if let Some(current) = self.current.clone() {
                let mut y: i32 = current[..4].parse()?;
                let mut m: u32 = current[5..].parse()?;
                loop {
                    if m == 12 {
                        y += 1;
                        m = 1
                    } else {
                        m += 1
                    }
                    let next = format!("{y:04}-{m:02}");
                    if next.as_str() >= month {
                        break;
                    }
                    self.begin_month(next)?;
                    self.flush()?;
                }
            }
            self.begin_month(month.to_owned())?;
        }
        let day = iso.replace('-', "").parse::<i64>()?;
        let mut prices_by_area: Map<String, Value> = Map::new();
        for r in records {
            let Some(&ci) = r[0].as_str().and_then(|s| self.by_source.get(s)) else {
                self.increment("unresolvedSource", 1);
                continue;
            };
            let area = area_key(&r[1])?;
            let next_id = self.areas.len();
            let ai = *self.area_ids.entry((ci, area.clone())).or_insert_with(|| {
                self.areas.push(json!([ci, area]));
                next_id
            });
            let key = ai.to_string();
            let region = self.complexes[ci]["r"].as_u64().ok_or("Invalid region")? as usize;
            let flags =
                r[13].as_i64().ok_or("Invalid inactive flags")? | i64::from(r[7] == "직거래");
            let prev = self.history.get(&key);
            let price = num(&r[5])?;
            let records = if flags == 0 {
                if let Some(p) = prev {
                    (if price > num(&p[2])? {
                        1
                    } else if price == num(&p[2])? {
                        8
                    } else {
                        0
                    }) | (if price < num(&p[3])? {
                        2
                    } else if price == num(&p[3])? {
                        16
                    } else {
                        0
                    }) | (if price < num(&p[1])? { 4 } else { 0 })
                } else {
                    32
                }
            } else {
                0
            };
            let identity = [0, 8, 9, 10, 11, 12, 13]
                .into_iter()
                .map(|i| pystr_or_empty(&r[i]))
                .collect::<Result<Vec<_>>>()?
                .join("|");
            let rid = hash(identity.as_bytes())[..24].to_owned();
            let p = prev.filter(|_| flags == 0);
            self.rows[region].push(json!([
                ai,
                day,
                r[5],
                r[6],
                flags,
                p.map(|v| v[0].clone()),
                p.map(|v| v[1].clone()),
                p.map(|v| v[2].clone()),
                p.map(|v| v[3].clone()),
                records,
                rid,
                p.map(|v| v[4].clone())
            ]));
            self.increment("rows", 1);
            if flags & 6 != 0 {
                self.increment("inactive", 1);
                continue;
            }
            self.increment("active", 1);
            if self.min.as_ref().is_none_or(|m| &iso < m) {
                self.min = Some(iso.clone())
            }
            if self.max.as_ref().is_none_or(|m| &iso > m) {
                self.max = Some(iso.clone())
            }
            if self.summaries.get(&iso).is_none() {
                self.summaries[&iso] = json!([0, 0, 0, 0])
            }
            let summary = self.summaries[&iso].as_array_mut().unwrap();
            for (i, n) in [
                1,
                i64::from(records & 1 != 0),
                i64::from(records & 4 != 0),
                i64::from(records & 2 != 0),
            ]
            .iter()
            .enumerate()
            {
                summary[i] = json!(summary[i].as_i64().unwrap() + n)
            }
            if flags == 0 {
                prices_by_area
                    .entry(key)
                    .or_insert(json!([]))
                    .as_array_mut()
                    .unwrap()
                    .push(r[5].clone());
            }
        }
        for (key, prices) in prices_by_area {
            let ai: usize = key.parse()?;
            let prices = arr(&prices)?;
            let low = prices
                .iter()
                .min_by(|a, b| a.as_f64().unwrap().total_cmp(&b.as_f64().unwrap()))
                .unwrap()
                .clone();
            let high = prices
                .iter()
                .max_by(|a, b| a.as_f64().unwrap().total_cmp(&b.as_f64().unwrap()))
                .unwrap()
                .clone();
            let prev = self.history.get(&key);
            let historical_high = prev
                .map(|p| {
                    if num(&p[2]).unwrap() > num(&high).unwrap() {
                        p[2].clone()
                    } else {
                        high.clone()
                    }
                })
                .unwrap_or(high.clone());
            let historical_low = prev
                .map(|p| {
                    if num(&p[3]).unwrap() < num(&low).unwrap() {
                        p[3].clone()
                    } else {
                        low.clone()
                    }
                })
                .unwrap_or(low.clone());
            self.history[&key] = json!([day, low, historical_high, historical_low, high]);
            let mean = rounded_mean(prices)?;
            let state = json!([ai, day, low, high, mean, prices.len()]);
            let ci = self.areas[ai][0].as_u64().unwrap() as usize;
            let region = self.complexes[ci]["r"].as_u64().unwrap() as usize;
            self.states[region][&key] = state.clone();
            self.updates[region].push(state);
        }
        Ok(records.len())
    }
}
fn area_key(v: &Value) -> Result<String> {
    let x = if let Some(s) = v.as_str() {
        s.parse::<f64>()?
    } else {
        num(v)?
    };
    if !x.is_finite() || x <= 0.0 {
        return Err("Invalid area".into());
    }
    Ok(format!("{x}"))
}
fn pystr_or_empty(v: &Value) -> Result<String> {
    Ok(match v {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        Value::Number(n) if n.as_f64() == Some(0.0) => String::new(),
        Value::Bool(false) => String::new(),
        Value::Bool(true) => "True".into(),
        _ => String::from_utf8(packed(v)?)?,
    })
}
fn rounded_mean(prices: &[Value]) -> Result<f64> {
    let mut integer = 0i128;
    let mut hi = 0.0;
    let mut lo = 0.0;
    let mut floating = false;
    for p in prices {
        if !floating {
            if let Some(n) = p.as_i64() {
                integer += i128::from(n);
                continue;
            }
            hi = integer as f64;
            floating = true
        }
        let x = num(p)?;
        let t = hi + x;
        if hi.abs() >= x.abs() {
            lo += (hi - t) + x
        } else {
            lo += (x - t) + hi
        }
        hi = t;
    }
    let sum = if floating { hi + lo } else { integer as f64 };
    if !sum.is_finite() {
        return Err("Non-finite daily price mean".into());
    }
    Ok(format!("{:.4}", sum / prices.len() as f64).parse()?)
}
fn prefix_restore(
    b: &mut Builder,
    c: &Connection,
    queries: &[String],
    cutoff: i64,
    cache_path: &Path,
    context: &str,
    tracking: (&mut Sha256, &mut bool),
) -> Result<Value> {
    let (prefix, scanned) = tracking;
    let cached = read(cache_path)?;
    let state = &cached["snapshot"];
    if cached["context"] != context || cached["snapshotHash"] != hash(&packed(state)?) {
        return Err("Invalid prefix checkpoint".into());
    }
    let selected: Vec<String> = queries
        .iter()
        .map(|q| format!("{q} AND (COALESCE(year,0)*100+COALESCE(month,0)) < ?"))
        .collect();
    let mut stmt = c.prepare(&(selected.join(" UNION ALL ") + ORDER))?;
    let mut rows = stmt.query(params_from_iter(vec![cutoff; queries.len()]))?;
    while let Some(r) = rows.next()? {
        prefix.update(packed(&sqlite_row(r)?)?);
        prefix.update(b"\n")
    }
    *scanned = true;
    if cached["prefixHash"] != format!("{:x}", prefix.clone().finalize()) {
        return Err("Prefix changed".into());
    }
    for (name, expected) in map(&state["files"])? {
        daily_name(name)?;
        if b.previous_index["sources"][name] != *expected
            || Some(digest(&safe(&b.previous, name)?)?.as_str()) != expected.as_str()
        {
            return Err("Invalid checkpoint shard".into());
        }
    }
    for name in map(&state["files"])?.keys() {
        let raw = fs::read(safe(&b.previous, name)?)?;
        let target = safe(&b.site, name)?;
        if fs::read(&target).ok().as_deref() != Some(&raw) {
            atomic(&target, &raw)?;
            b.written += 1
        } else {
            b.unchanged += 1
        }
        b.reused += 1;
    }
    b.restore(state.clone())?;
    Ok(state.clone())
}
fn process_day(
    b: &mut Builder,
    parts: &[Value],
    records: &[Value],
    today: &str,
    cutoff: Option<i64>,
    checkpoint: &mut Option<Value>,
) -> Result<usize> {
    if let Some(cutoff) = cutoff {
        if checkpoint.is_none()
            && parts[0].as_i64().unwrap_or(0) * 100 + parts[1].as_i64().unwrap_or(0) >= cutoff
        {
            b.flush()?;
            *checkpoint = Some(b.snapshot());
        }
    }
    b.day(parts, records, today)
}

pub fn build(spec: Value) -> Result<Value> {
    let site = path(&spec, "site")?.canonicalize()?;
    let database = path(&spec, "database")?;
    let missing = optional_path(&spec, "missing").filter(|p| p.exists());
    let cache_dir = optional_path(&spec, "cache_dir");
    let ledger_root = optional_path(&spec, "ledger_root");
    if let Some(guard) = optional_path(&spec, "guard") {
        let policy = read(&guard)?;
        if policy["site_publish_allowed"] != true || policy["projection_in_progress"] == true {
            return Err("Daily generation blocked by source transition policy".into());
        }
    }
    let previous = optional_path(&spec, "previous_site")
        .unwrap_or(site.clone())
        .canonicalize()?;
    let previous_index = read(&previous.join("data/daily/index.json"))
        .ok()
        .filter(|v| v.is_object() && v.get("sources").is_none_or(Value::is_object))
        .unwrap_or_else(obj);
    let today = spec["today"]
        .as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| Local::now().format("%Y-%m-%d").to_string());
    NaiveDate::parse_from_str(&today, "%Y-%m-%d")?;
    let map_path = site.join("data/map/index.json");
    let map_data = read(&map_path)?;
    let mut source_map: BTreeMap<String, Value> = BTreeMap::new();
    for c in arr(&map_data["d"])? {
        let members = c
            .get("memberSources")
            .cloned()
            .unwrap_or_else(|| json!([{"id":c["id"]}]));
        for s in arr(&members)? {
            source_map.insert(strv(&s["id"])?.to_owned(), c.clone());
        }
    }
    let mut sources = obj();
    sources["data/map/index.json"] = json!(digest(&map_path)?);
    let conn = Connection::open_with_flags(
        &database,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI,
    )?;
    conn.execute_batch("PRAGMA query_only=ON; BEGIN")?;
    let meta = metas(&conn)?;
    if meta["trade_projection_status"] != "complete" {
        return Err("Daily generation requires a completed API projection".into());
    }
    let revision = meta["trade_source_revision"].clone();
    let (mut complexes, mut by_source) = (Vec::new(), BTreeMap::new());
    {
        let mut stmt = conn.prepare(
            "SELECT apt_seq,region,complex_name,gu,dong FROM canonical_complex ORDER BY apt_seq",
        )?;
        let mut rows = stmt.query([])?;
        while let Some(row) = rows.next()? {
            let region: String = row.get(1)?;
            let region = match region.as_str() {
                "경기" => 0,
                "서울" => 1,
                "인천" => 2,
                _ => continue,
            };
            let id: String = row.get(0)?;
            let c = source_map.get(&id).cloned().unwrap_or_else(obj);
            let public = c["publicationId"]
                .as_str()
                .filter(|s| !s.is_empty())
                .or_else(|| c["id"].as_str().filter(|s| !s.is_empty()))
                .unwrap_or(&id)
                .to_owned();
            by_source.insert(id.clone(), complexes.len());
            complexes.push(json!({"id":id,"mapId":c["id"],"publicId":public,"n":row.get::<_,Option<String>>(2)?,"r":region,"g":row.get::<_,Option<String>>(3)?,"d":row.get::<_,Option<String>>(4)?,"coord":c["coord"],"b":c["b"],"tu":c["tu"],"admin":c.get("admin").cloned().unwrap_or_else(||json!([]))}));
        }
    }
    let mut queries = vec![
        format!("SELECT {FIELDS},0 AS inactive FROM transactions WHERE price>0 AND area>0"),
        format!(
            "SELECT {FIELDS},2 AS inactive FROM cancelled_transactions WHERE price>0 AND area>0"
        ),
    ];
    if let Some(missing) = &missing {
        let mut uri = reqwest::Url::from_file_path(missing.canonicalize()?)
            .map_err(|_| "Invalid missing DB path")?;
        uri.set_query(Some("mode=ro"));
        conn.execute("ATTACH DATABASE ? AS gone", [uri.as_str()])?;
        queries.push(format!("SELECT {FIELDS},4 AS inactive FROM gone.disappeared_transactions WHERE source_state='missing' AND price>0 AND area>0"));
    }
    let mut monthly = None;
    let mut ledger_values = Value::Null;
    if let (Some(cache_dir), Some(ledger_root)) = (&cache_dir, &ledger_root) {
        if !ledger_root
            .join("_ops/month-ledger-audit-block.json")
            .exists()
        {
            ledger_values = ledgers(&conn, missing.is_some())?;
            if !ledger_values.is_null() {
                let context = hash(&packed(&json!([3, env!("NODO_SOURCE_SHA"), complexes]))?);
                let root = cache_dir.join(format!(
                    "months-{}",
                    hash(absolute_name(&database)?.as_bytes())
                ));
                monthly = Some(MonthCache::new(
                    root,
                    context,
                    ledger_values.clone(),
                    today.clone(),
                ));
            }
        }
    }
    let mut b = Builder {
        site,
        previous,
        previous_index,
        complexes,
        by_source,
        areas: Vec::new(),
        area_ids: BTreeMap::new(),
        history: obj(),
        states: vec![obj(); 3],
        files: obj(),
        summaries: obj(),
        months: Vec::new(),
        counts: obj(),
        current: None,
        rows: vec![Vec::new(); 3],
        updates: vec![Vec::new(); 3],
        opening: vec![Vec::new(); 3],
        min: None,
        max: None,
        monthly,
        reused: 0,
        compressed: 0,
        written: 0,
        unchanged: 0,
    };
    let (mut cache_path, mut context, mut cutoff, mut checkpoint) = (None, None, None, None);
    let mut prefix_hash = Sha256::new();
    let mut prefix_scanned = false;
    let mut restored = false;
    let mut resume_month: Option<(i64, i64)> = None;
    if let Some(mut cache) = b.monthly.take() {
        if let Some(saved) = cache.restore(&b.site)? {
            b.restore(saved)?;
            let m = b.current.as_deref().ok_or("Missing restored month")?;
            resume_month = Some((m[..4].parse()?, m[5..].parse()?));
            restored = true;
            b.reused += map(&b.files)?.len();
        }
        eprintln!(
            "daily monthly cache: {}",
            json!({"restoredMonth":cache.restored,"reason":cache.reason})
        );
        b.monthly = Some(cache);
    } else if let (Some(cache_dir), Some(max)) = (&cache_dir, b.previous_index["maxDate"].as_str())
    {
        let cut = max
            .get(..7)
            .ok_or("Invalid previous maxDate")?
            .replace('-', "")
            .parse::<i64>()?;
        cutoff = Some(cut);
        let p = cache_dir.join(format!(
            "{}.json",
            hash(absolute_name(&database)?.as_bytes())
        ));
        let ctx = hash(&packed(&json!([
            2,
            env!("NODO_SOURCE_SHA"),
            cut,
            b.complexes
        ]))?);
        let initial = b.snapshot();
        match prefix_restore(
            &mut b,
            &conn,
            &queries,
            cut,
            &p,
            &ctx,
            (&mut prefix_hash, &mut prefix_scanned),
        ) {
            Ok(saved) => {
                checkpoint = Some(saved);
                restored = true
            }
            Err(_) => {
                b.restore(initial)?;
                if !prefix_scanned {
                    prefix_hash = Sha256::new()
                }
            }
        }
        cache_path = Some(p);
        context = Some(ctx);
    }
    let mut parameters: Vec<i64> = Vec::new();
    let selected: Vec<String> = queries
        .iter()
        .map(|q| {
            if let Some((y, m)) = resume_month {
                parameters.extend([y, m]);
                format!("{q} AND (year,month) > (?,?)")
            } else if restored {
                parameters.push(cutoff.unwrap());
                format!("{q} AND (COALESCE(year,0)*100+COALESCE(month,0)) >= ?")
            } else {
                q.clone()
            }
        })
        .collect();
    eprintln!(
        "daily checkpoint: {}",
        if restored { "reused" } else { "full" }
    );
    let mut scanned = 0;
    {
        let mut stmt = conn.prepare(&(selected.join(" UNION ALL ") + ORDER))?;
        let mut cursor = stmt.query(params_from_iter(parameters))?;
        let mut group = Vec::new();
        let mut parts: Option<Vec<Value>> = None;
        while let Some(row) = cursor.next()? {
            let row = sqlite_row(row)?;
            if let Some(cut) = cutoff {
                if !prefix_scanned
                    && row[2].as_i64().unwrap_or(0) * 100 + row[3].as_i64().unwrap_or(0) < cut
                {
                    prefix_hash.update(packed(&row)?);
                    prefix_hash.update(b"\n")
                }
            }
            let current = vec![row[2].clone(), row[3].clone(), row[4].clone()];
            if parts.as_ref().is_some_and(|p| p != &current) {
                scanned += process_day(
                    &mut b,
                    parts.as_ref().unwrap(),
                    &group,
                    &today,
                    cutoff,
                    &mut checkpoint,
                )?;
                group.clear();
            }
            parts = Some(current);
            group.push(row);
        }
        if let Some(parts) = parts {
            scanned += process_day(&mut b, &parts, &group, &today, cutoff, &mut checkpoint)?;
        }
    }
    b.flush()?;
    conn.execute_batch("COMMIT")?;
    let final_meta = metas(&conn)?;
    if b.monthly.is_some() && ledgers(&conn, missing.is_some())? != ledger_values {
        return Err("Monthly ledger changed during daily export".into());
    }
    if revision != final_meta["trade_source_revision"]
        || final_meta["trade_projection_status"] != "complete"
    {
        return Err("Projection changed during daily export; rebuild required".into());
    }
    if Some(digest(&map_path)?.as_str()) != sources["data/map/index.json"].as_str() {
        return Err("Map changed during daily export; rebuild required".into());
    }
    if b.max.is_none() {
        return Err("No active daily transactions".into());
    }
    let mut catalog = Map::new();
    catalog.insert(
        "complexes".into(),
        Value::Array(std::mem::take(&mut b.complexes)),
    );
    catalog.insert("areas".into(), Value::Array(std::mem::take(&mut b.areas)));
    b.write("data/daily/catalog.json", &Value::Object(catalog))?;
    for (k, v) in map(&b.files)? {
        sources[k] = v.clone()
    }
    // Python json.dumps(sort_keys=True) uses a space after each comma and colon.
    let sorted: BTreeMap<&String, &Value> = map(&sources)?.iter().collect();
    let version_content = format!(
        "{{{}}}",
        sorted
            .iter()
            .map(|(k, v)| Ok(format!(
                "{}: {}",
                serde_json::to_string(k)?,
                serde_json::to_string(v)?
            )))
            .collect::<Result<Vec<_>>>()?
            .join(", ")
    );
    let version = hash(version_content.as_bytes())[..16].to_owned();
    let updated = spec["updated"]
        .as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Micros, false));
    let mut result = json!({"schema":1,"encoding":"gzip-json","version":version,"updated":updated,"sourceRevision":revision,"mapVersion":map_data["meta"]["sourceVersion"],"minDate":b.min,"maxDate":b.max,"months":b.months,"counts":b.counts,"summary":b.summaries,"sources":sources});
    let mut old = b.previous_index.clone();
    old.as_object_mut().unwrap().shift_remove("updated");
    let mut current = result.clone();
    current.as_object_mut().unwrap().shift_remove("updated");
    if old == current
        && b.previous_index["updated"]
            .as_str()
            .is_some_and(|s| !s.is_empty())
    {
        result["updated"] = b.previous_index["updated"].clone()
    }
    b.write("data/daily/index.json", &result)?;
    if let (Some(path), Some(context), Some(checkpoint)) = (cache_path, context, checkpoint) {
        let payload = packed(
            &json!({"context":context,"prefixHash":format!("{:x}",prefix_hash.finalize()),"snapshot":checkpoint,"snapshotHash":hash(&packed(&checkpoint)?)}),
        )?;
        if fs::read(&path).ok().as_deref() != Some(&payload) {
            atomic(&path, &payload)?
        }
    }
    if let Some(cache) = &b.monthly {
        cache.commit(&b.counts)?
    }
    eprintln!("daily rows scanned: {scanned}");
    eprintln!(
        "daily reuse: {}",
        json!({"reused":b.reused,"compressed":b.compressed,"written":b.written,"unchanged":b.unchanged})
    );
    Ok(result)
}
pub fn validate(spec: Value) -> Result<Value> {
    let site = path(&spec, "site")?.canonicalize()?;
    let manifest = read(&site.join("data/daily/index.json"))?;
    for (name, expected) in map(&manifest["sources"])? {
        if Some(digest(&safe(&site, name)?)?.as_str()) != expected.as_str() {
            return Err(format!("Daily source changed: {name}").into());
        }
    }
    let mut result = json!({"version":manifest["version"]});
    for (k, v) in map(&manifest["counts"])? {
        result[k] = v.clone()
    }
    Ok(result)
}
