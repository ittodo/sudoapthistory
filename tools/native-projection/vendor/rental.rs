//! Read-only apartment rental projection and official conversion-rate refresh.
//! The runtime never launches Python. Cache proofs intentionally use this implementation.
use crate::Result;
use chrono::{Datelike, Local, NaiveDate, Utc};
use flate2::{read::GzDecoder, Compression, GzBuilder};
use rusqlite::{params, Connection, OpenFlags};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    time::Duration,
};

const REGIONS: [&str; 3] = ["11", "41", "28"];
const SOURCE: &str = "https://www.reb.or.kr/r-one/portal/stat/easyStatPage/A_2024_00156.do";
const TABLE: &str = "A_2024_00156";
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn object() -> Value {
    Value::Object(Map::new())
}
fn obj(v: &Value) -> Result<&Map<String, Value>> {
    v.as_object().ok_or("Expected object".into())
}
fn arr(v: &Value) -> Result<&Vec<Value>> {
    v.as_array().ok_or("Expected array".into())
}
fn string(v: &Value) -> Result<&str> {
    v.as_str().ok_or("Expected string".into())
}
fn num(v: &Value) -> Result<f64> {
    v.as_f64().ok_or("Expected number".into())
}
fn path(spec: &Value, key: &str) -> Result<PathBuf> {
    Ok(PathBuf::from(string(&spec[key])?))
}
fn today(spec: &Value) -> Result<String> {
    let day = spec["today"]
        .as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| Local::now().format("%Y-%m-%d").to_string());
    NaiveDate::parse_from_str(&day, "%Y-%m-%d")?;
    Ok(day)
}
// Match Python json.dumps' compact representation, including exponent zero padding.
fn pack_into(v: &Value, out: &mut String) -> Result<()> {
    match v {
        Value::Array(a) => {
            out.push('[');
            for (i, v) in a.iter().enumerate() {
                if i > 0 {
                    out.push(',')
                }
                pack_into(v, out)?;
            }
            out.push(']');
        }
        Value::Object(m) => {
            out.push('{');
            for (i, (k, v)) in m.iter().enumerate() {
                if i > 0 {
                    out.push(',')
                }
                out.push_str(&serde_json::to_string(k)?);
                out.push(':');
                pack_into(v, out)?;
            }
            out.push('}');
        }
        Value::Number(n) if n.is_f64() => {
            let x = n.as_f64().ok_or("Invalid float")?;
            let mut s = n.to_string();
            if let Some((mantissa, exp)) = s.split_once('e') {
                let e: i32 = exp.parse()?;
                s = format!(
                    "{}e{}{e:02}",
                    mantissa.strip_suffix(".0").unwrap_or(mantissa),
                    if e < 0 { "-" } else { "+" },
                    e = e.abs()
                );
            } else if x != 0.0 && x.abs() < 0.0001 {
                let e = format!("{x:e}");
                let (m, p) = e.split_once('e').ok_or("Float exponent")?;
                let p: i32 = p.parse()?;
                s = format!("{m}e{}{p:02}", if p < 0 { "-" } else { "+" }, p = p.abs());
            }
            out.push_str(&s);
        }
        _ => out.push_str(&serde_json::to_string(v)?),
    }
    Ok(())
}
pub(crate) fn packed(v: &Value) -> Result<Vec<u8>> {
    let mut out = String::new();
    pack_into(v, &mut out)?;
    Ok(out.into_bytes())
}
fn read(path: &Path) -> Result<Value> {
    Ok(serde_json::from_slice(&fs::read(path)?)?)
}
fn unzip(path: &Path) -> Result<Value> {
    let mut bytes = Vec::new();
    GzDecoder::new(fs::File::open(path)?).read_to_end(&mut bytes)?;
    Ok(serde_json::from_slice(&bytes)?)
}
fn write(path: &Path, value: &Value, binary: bool) -> Result<String> {
    write_packed(path, packed(value)?, binary)
}
fn write_packed(path: &Path, mut bytes: Vec<u8>, binary: bool) -> Result<String> {
    if binary {
        let mut zip = GzBuilder::new()
            .mtime(0)
            .operating_system(255)
            .write(Vec::new(), Compression::new(6));
        zip.write_all(&bytes)?;
        bytes = zip.finish()?;
    }
    fs::create_dir_all(path.parent().ok_or("Missing parent")?)?;
    if fs::read(path).ok().as_deref() != Some(&bytes) {
        let tmp = path.with_extension(format!(
            "{}.tmp",
            path.extension().and_then(|s| s.to_str()).unwrap_or("")
        ));
        fs::write(&tmp, &bytes)?;
        fs::rename(tmp, path)?;
    }
    Ok(hash(&bytes))
}
fn copy(from: &Path, to: &Path) -> Result<()> {
    fs::create_dir_all(to.parent().ok_or("Missing parent")?)?;
    fs::copy(from, to)?;
    Ok(())
}
fn valid_hash(path: &Path, expected: &Value) -> bool {
    fs::read(path)
        .map(|b| Some(hash(&b).as_str()) == expected.as_str())
        .unwrap_or(false)
}
fn effective(rates: &Value, region: &str, month: &str) -> Value {
    rates["rates"][region]
        .as_object()
        .and_then(|m| {
            m.iter()
                .filter(|(k, _)| k.as_str() <= month)
                .max_by_key(|(k, _)| *k)
        })
        .map(|(m, v)| json!({"value":v,"month":m}))
        .unwrap_or(Value::Null)
}
fn parse_rates(data: &Value) -> Result<Value> {
    let mut result = json!({"11":{},"41":{},"28":{}});
    for row in data["DATA"].as_array().unwrap_or(&Vec::new()) {
        let code = match row["CATE1"].as_str() {
            Some("서울") => "11",
            Some("경기") => "41",
            Some("인천") => "28",
            _ => continue,
        };
        for (key, val) in obj(row)? {
            let Some(month) = key
                .strip_prefix("COL_")
                .and_then(|s| s.strip_suffix("100001OD"))
            else {
                continue;
            };
            if month.len() != 6
                || !month.bytes().all(|b| b.is_ascii_digit())
                || val.is_null()
                || matches!(val.as_str(), Some("" | "-" | "…"))
            {
                continue;
            }
            let rate = if let Some(s) = val.as_str() {
                s.parse::<f64>()?
            } else {
                num(val)?
            };
            if !(rate > 0.0 && rate <= 100.0) {
                return Err("Invalid official conversion rate".into());
            }
            result[code][format!("{}-{}", &month[..4], &month[4..])] = json!(rate);
        }
    }
    if REGIONS
        .iter()
        .any(|r| result[r].as_object().is_none_or(|m| m.is_empty()))
    {
        return Err("Missing official province rates".into());
    }
    Ok(result)
}
/// Refresh atomically after validating complete regional history. `response` is an offline replay.
pub fn rates(spec: Value) -> Result<Value> {
    let destination = path(&spec, "destination")?;
    let day = today(&spec)?;
    let old = if destination.exists() {
        read(&destination)?
    } else {
        object()
    };
    if !spec["force"].as_bool().unwrap_or(false) && old["checkedDate"] == day {
        return Ok(old);
    }
    let bytes = if let Some(response) = spec.get("response") {
        packed(response)?
    } else {
        let client = reqwest::blocking::Client::builder()
            .cookie_store(true)
            .build()?;
        client
            .get(SOURCE)
            .timeout(Duration::from_secs(30))
            .send()?
            .error_for_status()?;
        let response = client
            .get("https://www.reb.or.kr/r-one/portal/stat/statEasyItmJson.do")
            .query(&[("statblId", TABLE)])
            .timeout(Duration::from_secs(30))
            .send()?
            .error_for_status()?
            .bytes()?;
        let data: Value = serde_json::from_slice(&response)?;
        let codes = arr(&data["data"])?
            .iter()
            .filter(|r| matches!(r["viewItmNm"].as_str(), Some("서울" | "경기" | "인천")))
            .map(|r| {
                r["datano"]
                    .as_str()
                    .map(str::to_owned)
                    .unwrap_or_else(|| r["datano"].to_string())
            })
            .collect::<Vec<_>>();
        if codes.len() != 3 {
            return Err("Official region codes changed".into());
        }
        let date = NaiveDate::parse_from_str(&day, "%Y-%m-%d")?;
        let form = [
            ("statblId", TABLE.to_owned()),
            ("viewLocOpt", "B".into()),
            ("wrttimeType", "B".into()),
            ("dtadvsVal", "OD".into()),
            ("wrttimeOrder", "A".into()),
            ("dtacycleCd", "MM".into()),
            ("wrttimeStartYear", "2011".into()),
            ("wrttimeEndYear", date.year().to_string()),
            ("wrttimeStartQt", "01".into()),
            ("wrttimeEndQt", format!("{:02}", date.month())),
            ("optDivVal", "00".into()),
            ("isRegionData", "Y".into()),
            ("chkItms", "100001".into()),
            ("chkClss", codes.join(",")),
        ];
        client
            .post("https://www.reb.or.kr/r-one/portal/stat/sttsDataPreviewList.do")
            .form(&form)
            .timeout(Duration::from_secs(60))
            .send()?
            .error_for_status()?
            .bytes()?
            .to_vec()
    };
    let rates = parse_rates(&serde_json::from_slice(&bytes)?)?;
    if let Some(regions) = old["rates"].as_object() {
        for (region, months) in regions {
            for month in obj(months)?.keys() {
                if rates[region].get(month).is_none() {
                    return Err("Official response unexpectedly lost history".into());
                }
            }
        }
    }
    let fetched = spec["fetched_at"]
        .as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Micros, false));
    let payload = json!({"schema":1,"table":TABLE,"source":SOURCE,"publisher":"한국부동산원","unit":"연 %","checkedDate":day,"fetchedAt":fetched,"rates":rates,"responseHash":hash(&bytes)});
    write(&destination, &payload, false)?;
    Ok(payload)
}
fn ledger(conn: &Connection) -> Result<Vec<Value>> {
    let mut stmt=conn.prepare("SELECT lawd,month,digest,row_count,rejected_count FROM contract_partition WHERE service='apartment-rent' ORDER BY month,lawd")?;
    let mut rows = stmt.query([])?;
    let mut entries = Vec::new();
    while let Some(row) = rows.next()? {
        let lawd: String = row.get(0)?;
        if !REGIONS.iter().any(|r| lawd.starts_with(r)) {
            continue;
        }
        entries.push(json!([
            lawd,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, i64>(3)?,
            row.get::<_, i64>(4)?
        ]));
    }
    Ok(entries)
}
fn envelope(points: &[Value], upper: bool) -> Result<Value> {
    let sign = if upper { 1.0 } else { -1.0 };
    let mut sorted = points.to_vec();
    sorted.sort_by(|a, b| {
        (sign * a[0].as_f64().unwrap())
            .total_cmp(&(sign * b[0].as_f64().unwrap()))
            .then_with(|| {
                (sign * b[1].as_f64().unwrap()).total_cmp(&(sign * a[1].as_f64().unwrap()))
            })
    });
    sorted.dedup_by(|a, b| a[0].as_f64() == b[0].as_f64());
    let mut hull: Vec<Value> = Vec::new();
    let mut starts = Vec::new();
    for point in sorted {
        let a = sign * num(&point[0])?;
        let b = sign * num(&point[1])?;
        let mut x = f64::NEG_INFINITY;
        while let Some(last) = hull.last() {
            x = (sign * num(&last[1])? - b) / (a - sign * num(&last[0])?);
            if x > *starts.last().unwrap() {
                break;
            }
            hull.pop();
            starts.pop();
        }
        starts.push(if hull.is_empty() {
            f64::NEG_INFINITY
        } else {
            x
        });
        hull.push(point);
    }
    Ok(json!(hull))
}
fn value(pair: &Value, rate: &Value) -> Result<Value> {
    Ok(if rate.is_null() {
        pair[0].clone()
    } else {
        json!(num(&pair[1])? + num(&pair[0])? * num(rate)? / 1200.0)
    })
}
fn bounds(points: &[Value], rate: &Value) -> Result<Vec<Value>> {
    let mut vs = points
        .iter()
        .map(|p| value(p, rate))
        .collect::<Result<Vec<_>>>()?;
    vs.sort_by(|a, b| a.as_f64().unwrap().total_cmp(&b.as_f64().unwrap()));
    Ok(vec![
        vs.first().ok_or("Empty bounds")?.clone(),
        vs.last().unwrap().clone(),
    ])
}
fn decimal_area(v: &Value) -> Result<String> {
    let x = num(v)?;
    let s = if v.is_f64() {
        format!("{x}")
    } else {
        v.to_string()
    };
    Ok(s)
}
fn add(a: &Value, b: &Value) -> Result<Value> {
    Ok(if let (Some(a), Some(b)) = (a.as_i64(), b.as_i64()) {
        json!(a.checked_add(b).ok_or("Integer overflow")?)
    } else {
        json!(num(a)? + num(b)?)
    })
}
fn prefix_file(p: &str, month: &str) -> bool {
    p.contains("/months/")
        && Path::new(p)
            .file_name()
            .and_then(|s| s.to_str())
            .and_then(|s| s.get(..7))
            .is_some_and(|s| s <= month)
}
/// Build read-only projection from a snapshot transaction, validating its ledger afterward.
pub fn build(spec: Value) -> Result<Value> {
    let site = path(&spec, "site")?;
    let database = path(&spec, "database")?;
    let cache = path(&spec, "cache")?;
    let day = today(&spec)?;
    fs::create_dir_all(&cache)?;
    let rates = read(&path(&spec, "rates_path")?)?;
    let mut catalog = arr(&unzip(&site.join("data/daily/catalog.bin"))?["complexes"])?.clone();
    let proof = hash(&packed(&json!([
        hash(include_bytes!("rental.rs")),
        hash(&packed(&json!(catalog))?),
        rates["rates"]
    ]))?);
    let mut lookup: BTreeMap<String, usize> = catalog
        .iter()
        .enumerate()
        .map(|(i, c)| Ok((string(&c["id"])?.to_owned(), i)))
        .collect::<Result<_>>()?;
    let index_path = cache.join("index.json");
    let old = if index_path.exists() {
        read(&index_path)?
    } else {
        object()
    };
    let conn = Connection::open_with_flags(database, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    conn.execute_batch("BEGIN")?;
    let entries = ledger(&conn)?;
    let mut coverage = object();
    let mut monthly: BTreeMap<String, Vec<Value>> = BTreeMap::new();
    for entry in &entries {
        let lawd = string(&entry[0])?;
        let ym = string(&entry[1])?;
        if ym.len() != 6 || !ym.bytes().all(|b| b.is_ascii_digit()) {
            return Err("Invalid rental partition month".into());
        }
        let month = format!("{}-{}", &ym[..4], &ym[4..]);
        monthly
            .entry(month.clone())
            .or_default()
            .push(json!([lawd, entry[2], entry[3], entry[4]]));
        if coverage.get(lawd).is_none() {
            coverage[lawd] = object()
        }
        coverage[lawd][&month] = json!({"rows":entry[3],"rejected":entry[4]});
    }
    let months: Vec<String> = monthly.keys().cloned().collect();
    let mut signatures = object();
    for (m, p) in &monthly {
        signatures[m] = json!(hash(&packed(&json!(p))?))
    }
    let mut union: BTreeSet<String> = months.iter().cloned().collect();
    if let Some(old_months) = old["months"].as_object() {
        union.extend(old_months.keys().cloned())
    }
    let changed = union
        .into_iter()
        .find(|m| signatures[m] != old["months"][m]);
    let mut checkpoint: Option<String> = None;
    if old["proof"] == proof {
        for m in months.iter().rev() {
            if changed.as_ref().is_some_and(|c| m >= c) {
                continue;
            }
            if old["states"].get(m).is_none()
                || !valid_hash(&cache.join(format!("state-{m}.bin")), &old["states"][m])
            {
                continue;
            }
            let Some(files) = old["files"].as_object() else {
                continue;
            };
            if files
                .iter()
                .filter(|(p, _)| prefix_file(p, m))
                .all(|(p, h)| valid_hash(&cache.join(p), h))
            {
                checkpoint = Some(m.clone());
                break;
            }
        }
    }
    let (mut history, mut latest, mut summaries, mut files, mut states) =
        (object(), object(), object(), object(), object());
    if let Some(m) = &checkpoint {
        let Value::Object(mut saved) = unzip(&cache.join(format!("state-{m}.bin")))? else {
            return Err("Invalid rental checkpoint".into());
        };
        history = saved
            .shift_remove("history")
            .ok_or("Missing rental history")?;
        latest = saved
            .shift_remove("latest")
            .ok_or("Missing rental latest state")?;
        summaries = saved
            .shift_remove("summaries")
            .ok_or("Missing rental summaries")?;
        catalog = match saved.shift_remove("catalog") {
            Some(Value::Array(values)) => values,
            _ => return Err("Missing rental catalog".into()),
        };
        lookup = catalog
            .iter()
            .enumerate()
            .map(|(i, c)| Ok((string(&c["id"])?.to_owned(), i)))
            .collect::<Result<_>>()?;
        for (p, h) in obj(&old["files"])? {
            if prefix_file(p, m) {
                copy(&cache.join(p), &site.join(p))?;
                files[p] = h.clone()
            }
        }
        for (k, h) in obj(&old["states"])? {
            if k <= m {
                states[k] = h.clone()
            }
        }
    }
    let mut scanned = 0;
    for month in &months {
        if checkpoint.as_ref().is_some_and(|m| month <= m) {
            continue;
        }
        // Keep month-opening values in place; only changed keys need another row.
        let mut pending_latest = Map::new();
        let mut all_rows: Vec<Value> = Vec::new();
        let mut month_rates = object();
        for r in REGIONS {
            month_rates[r] = effective(&rates, r, month)
        }
        for partition in &monthly[month] {
            let lawd = string(&partition[0])?;
            let mut stmt=conn.prepare("SELECT ordinal,payload FROM contract_record WHERE service='apartment-rent' AND lawd=? AND month=? ORDER BY ordinal")?;
            let mut rows = stmt.query(params![lawd, month.replace('-', "")])?;
            while let Some(row) = rows.next()? {
                let ordinal: i64 = row.get(0)?;
                let raw: Value = serde_json::from_str(&row.get::<_, String>(1)?)?;
                scanned += 1;
                if raw["property"] != "apartment" {
                    return Err("Wrong rental property".into());
                }
                let Some(date) = raw["date"].as_str() else {
                    continue;
                };
                if date.len() != 10
                    || NaiveDate::parse_from_str(date, "%Y-%m-%d").is_err()
                    || !date.starts_with(month)
                    || date > day.as_str()
                {
                    continue;
                }
                let source = raw["aptSeq"]
                    .as_str()
                    .filter(|s| !s.is_empty())
                    .or_else(|| raw["entityId"].as_str().filter(|s| !s.is_empty()))
                    .map(str::to_owned)
                    .unwrap_or_else(|| {
                        format!(
                            "unresolved:{lawd}:{}",
                            &hash(
                                &packed(&json!([raw["name"], raw["dong"], raw["jibun"]])).unwrap()
                            )[..20]
                        )
                    });
                if !lookup.contains_key(&source) {
                    lookup.insert(source.clone(), catalog.len());
                    catalog.push(json!({"id":source,"publicId":null,"mapId":null,"n":raw["name"].as_str().filter(|s|!s.is_empty()).unwrap_or("단지 미상"),"g":lawd,"d":raw.get("dong").cloned().unwrap_or(json!("")),"r":match &lawd[..2]{"41"=>0,"11"=>1,_=>2},"coord":null}));
                }
                let (d, m, a) = (&raw["deposit"], &raw["monthlyRent"], &raw["area"]);
                if d.is_null()
                    || m.is_null()
                    || num(d)? < 0.0
                    || num(m)? < 0.0
                    || a.is_null()
                    || num(a)? <= 0.0
                {
                    continue;
                }
                let area = decimal_area(a)?;
                let identity =
                    hash(&packed(&json!([lawd, month, ordinal, raw]))?)[..20].to_string();
                let kind = match raw["contractType"].as_str() {
                    Some("신규") => 1,
                    Some("갱신") => 2,
                    _ => 0,
                };
                let cancelled = match &raw["cancelled"] {
                    Value::Null => false,
                    Value::Bool(b) => *b,
                    Value::Number(n) => n.as_f64() != Some(0.0),
                    Value::String(s) => !s.is_empty(),
                    Value::Array(a) => !a.is_empty(),
                    Value::Object(m) => !m.is_empty(),
                };
                all_rows.push(json!([
                    lookup[&source],
                    area,
                    date.replace('-', "").parse::<i64>()?,
                    d,
                    m,
                    kind,
                    raw["floor"],
                    i32::from(cancelled),
                    identity,
                    &lawd[..2]
                ]));
            }
        }
        all_rows.sort_by(|a, b| {
            a[2].as_i64()
                .cmp(&b[2].as_i64())
                .then_with(|| a[0].as_u64().cmp(&b[0].as_u64()))
                .then_with(|| a[1].as_str().cmp(&b[1].as_str()))
                .then_with(|| (a[4].as_f64().unwrap() > 0.0).cmp(&(b[4].as_f64().unwrap() > 0.0)))
                .then_with(|| a[5].as_i64().cmp(&b[5].as_i64()))
                .then_with(|| a[8].as_str().cmp(&b[8].as_str()))
        });
        let mut outputs = json!({"11":[],"41":[],"28":[]});
        let mut updates = outputs.clone();
        let mut summary = json!({"11":{"jeonse":{},"monthly":{}},"41":{"jeonse":{},"monthly":{}},"28":{"jeonse":{},"monthly":{}}});
        let mut first = 0;
        while first < all_rows.len() {
            let lead = &all_rows[first];
            let monthly_rent = num(&lead[4])? > 0.0;
            let key = String::from_utf8(packed(&json!([
                lead[0],
                lead[1],
                i32::from(monthly_rent),
                lead[5]
            ]))?)?;
            let mut end = first + 1;
            while end < all_rows.len() {
                let row = &all_rows[end];
                if row[2] != lead[2]
                    || row[0] != lead[0]
                    || row[1] != lead[1]
                    || (num(&row[4])? > 0.0) != monthly_rent
                    || row[5] != lead[5]
                {
                    break;
                }
                end += 1
            }
            let past = history.get(&key).cloned();
            let region = string(&lead[9])?;
            let official = &month_rates[region];
            let rate = if monthly_rent && !official.is_null() {
                official["value"].clone()
            } else {
                Value::Null
            };
            let comparable = !monthly_rent || !official.is_null();
            let pb = if let Some(p) = past.as_ref().filter(|_| comparable) {
                bounds(arr(&p["previous"])?, &rate)?
            } else {
                vec![Value::Null; 2]
            };
            let hb = if let Some(p) = past.as_ref().filter(|_| comparable) {
                let mut points = arr(&p["low"])?.clone();
                points.extend(arr(&p["high"])?.clone());
                bounds(&points, &rate)?
            } else {
                vec![Value::Null; 2]
            };
            let mut active = Vec::new();
            for row in &all_rows[first..end] {
                let pair = json!([row[3], row[4]]);
                let cancelled = row[7] == 1;
                let v = if comparable && !cancelled {
                    value(&pair, &rate)?
                } else {
                    Value::Null
                };
                let mut flags = 0;
                if !v.is_null() {
                    if past.is_none() {
                        flags = 32
                    } else {
                        let x = num(&v)?;
                        flags = if x > num(&hb[1])? + 1e-8 { 1 } else { 0 };
                        flags |= if x < num(&hb[0])? - 1e-8 { 2 } else { 0 };
                        flags |= if x < num(&pb[0])? - 1e-8 {
                            4
                        } else if x > num(&pb[1])? + 1e-8 {
                            8
                        } else {
                            16
                        };
                    }
                }
                let result = json!([
                    row[0],
                    row[1],
                    row[2],
                    row[3],
                    row[4],
                    row[5],
                    row[6],
                    row[7],
                    past.as_ref()
                        .map(|p| p["day"].clone())
                        .unwrap_or(Value::Null),
                    pb[0],
                    pb[1],
                    hb[0],
                    hb[1],
                    v,
                    flags,
                    if monthly_rent {
                        official["month"].clone()
                    } else {
                        Value::Null
                    },
                    rate,
                    row[8]
                ]);
                outputs[region].as_array_mut().unwrap().push(result.clone());
                if !cancelled {
                    active.push(pair);
                    pending_latest.insert(key.clone(), result.clone());
                    updates[region].as_array_mut().unwrap().push(result);
                    let typ = if monthly_rent { "monthly" } else { "jeonse" };
                    let kind = row[5].to_string();
                    if summary[region][typ].get(&kind).is_none() {
                        summary[region][typ][&kind] = json!([0, 0, 0, 0, 0, 0, 0, 0])
                    }
                    let stats = summary[region][typ][&kind].as_array_mut().unwrap();
                    let increments = [
                        json!(1),
                        row[3].clone(),
                        row[4].clone(),
                        if v.is_null() || num(&v)? == 0.0 {
                            json!(0)
                        } else {
                            v.clone()
                        },
                        json!(i32::from(!v.is_null())),
                        json!(i32::from(flags & 8 != 0)),
                        json!(i32::from(flags & 4 != 0)),
                        json!(i32::from(flags & 1 != 0)),
                    ];
                    for (i, inc) in increments.iter().enumerate() {
                        stats[i] = add(&stats[i], inc)?
                    }
                }
            }
            if !active.is_empty() {
                let mut low = past
                    .as_ref()
                    .and_then(|p| p["low"].as_array())
                    .cloned()
                    .unwrap_or_default();
                let mut high = past
                    .as_ref()
                    .and_then(|p| p["high"].as_array())
                    .cloned()
                    .unwrap_or_default();
                low.extend(active.clone());
                high.extend(active.clone());
                history[&key] = json!({"day":lead[2],"previous":active,"low":envelope(&low,false)?,"high":envelope(&high,true)?})
            }
            first = end;
        }
        // Row inputs are no longer needed. Move output rows into their envelopes;
        // json!(&large_value) would create a second deep tree before serialization.
        drop(all_rows);
        for region in REGIONS {
            for suffix in ["", "-state"] {
                let p = format!("data/rental/months/{month}-{region}{suffix}.bin");
                let digest = if suffix.is_empty() {
                    let mut content = Map::new();
                    content.insert("rows".into(), outputs[region].take());
                    write(&site.join(&p), &Value::Object(content), true)?
                } else {
                    // Borrow opening rows instead of cloning the accumulated latest
                    // tree. Reuse the Python-compatible number/string encoder.
                    let mut content = String::from("{\"opening\":[");
                    let mut first = true;
                    for row in obj(&latest)?.values() {
                        let ci = row[0].as_u64().unwrap() as usize;
                        let row_region = match catalog[ci]["r"].as_i64() {
                            Some(0) => "41",
                            Some(1) => "11",
                            _ => "28",
                        };
                        if row_region != region {
                            continue;
                        }
                        if !first {
                            content.push(',');
                        }
                        first = false;
                        pack_into(row, &mut content)?;
                    }
                    content.push_str("],\"updates\":");
                    pack_into(&updates[region], &mut content)?;
                    content.push('}');
                    updates[region] = Value::Null;
                    write_packed(&site.join(&p), content.into_bytes(), true)?
                };
                files[&p] = json!(digest);
                copy(&site.join(&p), &cache.join(&p))?
            }
        }
        drop(outputs);
        drop(updates);
        // Map preserves first appearance order. Updating an existing key keeps
        // its position; a new key is appended, with the last active row winning.
        let latest_map = latest.as_object_mut().ok_or("Expected latest object")?;
        for (key, row) in pending_latest {
            latest_map.insert(key, row);
        }
        summaries[month] = summary;
        // Temporarily transfer ownership instead of cloning the entire accumulated
        // history/latest/catalog on every checkpoint. Restore the same trees after
        // writing; insertion order and therefore checkpoint bytes remain unchanged.
        let mut state = Map::new();
        state.insert("history".into(), history.take());
        state.insert("latest".into(), latest.take());
        state.insert("summaries".into(), summaries.take());
        state.insert("catalog".into(), Value::Array(std::mem::take(&mut catalog)));
        let mut state = Value::Object(state);
        states[month] = json!(write(
            &cache.join(format!("state-{month}.bin")),
            &state,
            true
        )?);
        history = state["history"].take();
        latest = state["latest"].take();
        summaries = state["summaries"].take();
        catalog = match state["catalog"].take() {
            Value::Array(values) => values,
            _ => unreachable!("checkpoint catalog was constructed as an array"),
        };
    }
    conn.execute_batch("COMMIT")?;
    if ledger(&conn)? != entries {
        return Err("Rental source changed during generation".into());
    }
    let mut public_catalog = Map::new();
    public_catalog.insert("complexes".into(), Value::Array(catalog));
    files["data/rental/catalog.bin"] = json!(write(
        &site.join("data/rental/catalog.bin"),
        &Value::Object(public_catalog),
        true
    )?);
    // The yearly history pass only needs published month files. Do not retain a
    // complete checkpoint in memory while collecting a year's transaction rows.
    drop(history);
    drop(latest);
    drop(lookup);
    let mut public_rates = rates.clone();
    for key in ["fetchedAt", "checkedDate", "responseHash"] {
        public_rates
            .as_object_mut()
            .ok_or("Invalid rates")?
            .shift_remove(key);
    }
    files["data/rental/rates.json"] = json!(write(
        &site.join("data/rental/rates.json"),
        &public_rates,
        false
    )?);
    files["data/rental/summary.json"] = json!(write(
        &site.join("data/rental/summary.json"),
        &summaries,
        false
    )?);
    let years: BTreeSet<String> = months.iter().map(|m| m[..4].to_owned()).collect();
    let affected: BTreeSet<&str> = months
        .iter()
        .filter(|m| checkpoint.as_ref().is_none_or(|c| *m > c))
        .map(|m| &m[..4])
        .collect();
    for year in &years {
        if checkpoint.is_some() && !affected.contains(year.as_str()) {
            for (p, h) in obj(&old["files"])? {
                if p.starts_with(&format!("data/rental/history/{year}/")) {
                    if !valid_hash(&cache.join(p), h) {
                        return Err("Corrupt rental history cache".into());
                    }
                    copy(&cache.join(p), &site.join(p))?;
                    files[p] = h.clone()
                }
            }
            continue;
        }
        let mut buckets = object();
        for month in months.iter().filter(|m| m.starts_with(year)) {
            for region in REGIONS {
                let mut month_data =
                    unzip(&site.join(format!("data/rental/months/{month}-{region}.bin")))?;
                let Value::Array(rows) = month_data["rows"].take() else {
                    return Err("Invalid rental month rows".into());
                };
                for row in rows {
                    let bucket = (row[0].as_u64().ok_or("Invalid complex")? % 64).to_string();
                    if buckets.get(&bucket).is_none() {
                        buckets[&bucket] = json!([])
                    }
                    buckets[&bucket].as_array_mut().unwrap().push(row)
                }
            }
        }
        let Value::Object(buckets) = buckets else {
            unreachable!()
        };
        for (bucket, rows) in buckets {
            let p = format!(
                "data/rental/history/{year}/{:02}.bin",
                bucket.parse::<u64>()?
            );
            let mut content = Map::new();
            content.insert("rows".into(), rows);
            files[&p] = json!(write(&site.join(&p), &Value::Object(content), true)?);
            copy(&site.join(&p), &cache.join(&p))?
        }
    }
    let result = json!({"schema":1,"months":months,"coverage":coverage,"sources":files,"historyYears":years,"fields":["complex","area","date","deposit","monthlyRent","contract","floor","cancelled","previousDate","previousLow","previousHigh","historyLow","historyHigh","value","records","rateMonth","rate","id"],"mapVersion":read(&site.join("data/map/index.json"))?["meta"]["sourceVersion"],"version":&hash(&packed(&files)?)[..16],"historyBasis":"보유 이력 기준"});
    write(&site.join("data/rental/index.json"), &result, false)?;
    write(
        &index_path,
        &json!({"proof":proof,"months":signatures,"files":files,"states":states}),
        false,
    )?;
    eprintln!("rental rowsRead={scanned} restoredMonth={checkpoint:?}");
    Ok(result)
}
pub fn validate(spec: Value) -> Result<Value> {
    let site = path(&spec, "site")?.canonicalize()?;
    let manifest = read(&site.join("data/rental/index.json"))?;
    for (name, expected) in obj(&manifest["sources"])? {
        if !name.starts_with("data/rental/") {
            return Err("Invalid rental asset".into());
        }
        let p = crate::apartment_rent::safe(&site, name)?;
        let raw = fs::read(p)?;
        if Some(hash(&raw).as_str()) != expected.as_str() || raw.len() > 25 * 1024 * 1024 {
            return Err(format!("Rental asset invalid: {name}").into());
        }
    }
    Ok(json!({"version":manifest["version"],"files":obj(&manifest["sources"] )?.len()}))
}
