//! Bounded row streaming -> stage-local SQLite -> ordered streaming JSON.
//! No source database is opened. Scratch is removed on both success and failure.
use crate::Result;
use rusqlite::{params, Connection};
use serde::{
    de::{self, DeserializeSeed, MapAccess, SeqAccess, Visitor},
    Deserialize,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fmt,
    fs::{self, File},
    io::{BufReader, BufWriter, Read, Write},
    path::{Path, PathBuf},
};

#[derive(Deserialize)]
pub struct Request {
    root: PathBuf,
    #[serde(default)]
    verify: bool,
}
#[derive(Deserialize)]
struct Manifest {
    partitions: Vec<Partition>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Partition {
    path: String,
    service: String,
    lawd: String,
    month: String,
    count: u64,
    checked_at: Value,
}
#[derive(Deserialize)]
struct Catalog {
    lookup: HashMap<String, (String, String)>,
}

pub(crate) fn hash(path: &Path) -> Result<String> {
    let mut file = BufReader::new(File::open(path)?);
    let mut digest = Sha256::new();
    let mut buffer = [0; 65536];
    loop {
        let n = file.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        digest.update(&buffer[..n]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

// Reject symlinks/junction escapes as well as textual traversal, including output parents.
pub(crate) fn safe(root: &Path, relative: &str) -> Result<PathBuf> {
    let mut path = root.to_path_buf();
    for part in relative.split('/') {
        if part.is_empty() || part == "." || part == ".." || part.contains(['\\', ':']) {
            return Err("Unsafe path".into());
        }
        path.push(part);
        if let Ok(meta) = fs::symlink_metadata(&path) {
            if meta.file_type().is_symlink() || !path.canonicalize()?.starts_with(root) {
                return Err("Unsafe link".into());
            }
        }
    }
    Ok(path)
}
fn digits(s: &str, n: usize) -> bool {
    s.len() == n && s.bytes().all(|b| b.is_ascii_digit())
}
fn partition_path(p: &Partition) -> Result<()> {
    let parts: Vec<_> = p.path.split('/').collect();
    if parts.len() != 3
        || parts[0].is_empty()
        || !parts[0]
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b == b'-')
        || !digits(parts[1], 5)
        || !parts[2].ends_with(".json")
        || !digits(&parts[2][..parts[2].len() - 5], 6)
        || parts[0] != p.service
        || parts[1] != p.lawd
        || parts[2] != format!("{}.json", p.month)
    {
        return Err("Invalid contract partition path/metadata".into());
    }
    Ok(())
}

// ECMAScript Object.keys enumerates array-index keys before insertion-ordered keys.
fn array_index(s: &str) -> Option<u32> {
    let n: u32 = s.parse().ok()?;
    (n != u32::MAX && n.to_string() == s).then_some(n)
}
pub(crate) fn js_order(keys: &mut [String]) {
    keys.sort_by(|a, b| match (array_index(a), array_index(b)) {
        (Some(a), Some(b)) => a.cmp(&b),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        _ => std::cmp::Ordering::Equal,
    });
}

// Preserve source object order and use ECMAScript number spelling (1.0 -> 1, -0 -> 0).
pub(crate) fn js_write<W: Write>(out: &mut W, v: &Value) -> Result<()> {
    match v {
        Value::Number(n) => {
            let mut b = ryu_js::Buffer::new();
            out.write_all(b.format(n.as_f64().ok_or("Invalid number")?).as_bytes())?;
        }
        Value::Array(values) => {
            out.write_all(b"[")?;
            for (i, v) in values.iter().enumerate() {
                if i > 0 {
                    out.write_all(b",")?;
                }
                js_write(out, v)?;
            }
            out.write_all(b"]")?;
        }
        Value::Object(values) => {
            let mut keys: Vec<_> = values.keys().cloned().collect();
            js_order(&mut keys);
            out.write_all(b"{")?;
            for (i, k) in keys.iter().enumerate() {
                if i > 0 {
                    out.write_all(b",")?;
                }
                serde_json::to_writer(&mut *out, k)?;
                out.write_all(b":")?;
                js_write(out, &values[k])?;
            }
            out.write_all(b"}")?;
        }
        _ => serde_json::to_writer(out, v)?,
    }
    Ok(())
}
pub(crate) fn js(v: &Value) -> Result<String> {
    let mut bytes = Vec::new();
    js_write(&mut bytes, v)?;
    Ok(String::from_utf8(bytes)?)
}

pub(crate) struct Scratch(pub(crate) PathBuf);
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

struct Rows<'a, F>(&'a mut F);
impl<'de, F: FnMut(Value) -> Result<()>> DeserializeSeed<'de> for Rows<'_, F> {
    type Value = u64;
    fn deserialize<D: serde::Deserializer<'de>>(self, d: D) -> std::result::Result<u64, D::Error> {
        d.deserialize_seq(self)
    }
}
impl<'de, F: FnMut(Value) -> Result<()>> Visitor<'de> for Rows<'_, F> {
    type Value = u64;
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("contract rows array")
    }
    fn visit_seq<A: SeqAccess<'de>>(self, mut a: A) -> std::result::Result<u64, A::Error> {
        let mut count = 0;
        while let Some(row) = a.next_element::<Value>()? {
            (self.0)(row).map_err(de::Error::custom)?;
            count += 1;
        }
        Ok(count)
    }
}
struct PartitionReader<'a, F>(&'a mut F);
impl<'de, F: FnMut(Value) -> Result<()>> Visitor<'de> for PartitionReader<'_, F> {
    type Value = u64;
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("contract partition object")
    }
    fn visit_map<A: MapAccess<'de>>(self, mut a: A) -> std::result::Result<u64, A::Error> {
        let mut count = None;
        while let Some(key) = a.next_key::<String>()? {
            if key == "rows" {
                if count.is_some() {
                    return Err(de::Error::custom("Duplicate rows"));
                }
                count = Some(a.next_value_seed(Rows(self.0))?);
            } else {
                a.next_value::<de::IgnoredAny>()?;
            }
        }
        count.ok_or_else(|| de::Error::custom("Missing rows"))
    }
}
fn read_rows(path: &Path, callback: &mut impl FnMut(Value) -> Result<()>) -> Result<u64> {
    let mut parser =
        serde_json::Deserializer::from_reader(BufReader::with_capacity(65536, File::open(path)?));
    let n = serde::Deserializer::deserialize_map(&mut parser, PartitionReader(callback))?;
    parser.end()?;
    Ok(n)
}

pub fn build(request: Request) -> Result<Value> {
    let root = request.root.canonicalize()?;
    let catalog_path = safe(&root, "data/apartments/index.json")?;
    let manifest_path = safe(&root, "data/contracts/index.json")?;
    let catalog_hash = hash(&catalog_path)?;
    let contracts_hash = hash(&manifest_path)?;
    let catalog: Catalog = serde_json::from_reader(BufReader::new(File::open(&catalog_path)?))?;
    let manifest: Manifest = serde_json::from_reader(BufReader::new(File::open(&manifest_path)?))?;
    for (id, shard) in catalog.lookup.values() {
        if id.is_empty()
            || shard.len() != 2
            || !shard
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err("Invalid apartment mapping".into());
        }
    }
    let scratch_path = safe(&root, ".apartment-rent-work")?;
    fs::create_dir(&scratch_path)?; // Exclusive: never delete pre-existing work.
    let scratch = Scratch(scratch_path);
    let mut db = Connection::open(scratch.0.join("rows.sqlite"))?;
    db.execute_batch("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA temp_store=FILE; PRAGMA cache_size=-32768; PRAGMA mmap_size=0;
        CREATE TABLE rows (seq INTEGER PRIMARY KEY, apt INTEGER NOT NULL, date TEXT NOT NULL, area REAL NOT NULL, payload TEXT NOT NULL);
        CREATE TABLE areas (apt INTEGER, area REAL, PRIMARY KEY(apt,area)) WITHOUT ROWID;")?;
    struct Apartment {
        shard: String,
        districts: Vec<String>,
        count: u64,
        rank: usize,
    }
    let mut apartments: HashMap<String, Apartment> = HashMap::new();
    let mut shard_ids: HashMap<String, Vec<String>> = HashMap::new();
    let mut shard_order = Vec::new();
    let mut coverage = json!({});
    let mut sources = json!({});
    let mut paths = HashSet::new();
    let mut total = 0_u64;
    let mut linked = 0_u64;
    {
        let tx = db.transaction()?;
        let mut insert = tx.prepare("INSERT INTO rows VALUES (?,?,?,?,?)")?;
        let mut area_insert = tx.prepare("INSERT OR IGNORE INTO areas VALUES (?,?)")?;
        for p in &manifest.partitions {
            partition_path(p)?;
            if !paths.insert(&p.path) {
                return Err("Duplicate contract partition".into());
            }
            let relative = format!("data/contracts/{}", p.path);
            let path = safe(&root, &relative)?;
            let source_hash = hash(&path)?;
            sources[&relative] = json!(source_hash);
            // Non-rental services are opaque hashed inputs, never materialized/parsed.
            if p.service != "apartment-rent" {
                continue;
            }
            if coverage.get(&p.lawd).is_none() {
                coverage[&p.lawd] = json!({});
            }
            coverage[&p.lawd][&p.month] = p.checked_at.clone();
            let mut seen = 0_u64;
            let count = read_rows(&path, &mut |row| {
                seen += 1;
                if seen > p.count {
                    return Err("Contract count mismatch".into());
                }
                total += 1;
                let source = row["aptSeq"]
                    .as_str()
                    .filter(|s| !s.is_empty())
                    .or_else(|| row["entityId"].as_str());
                let Some((id, shard)) = source.and_then(|s| catalog.lookup.get(s)) else {
                    return Ok(());
                };
                let date = row["date"].as_str().ok_or("Invalid contract date")?;
                if !date.is_ascii()
                    || date.len() != 10
                    || !digits(&date[..4], 4)
                    || &date[4..5] != "-"
                    || !digits(&date[5..7], 2)
                    || &date[7..8] != "-"
                    || !digits(&date[8..], 2)
                {
                    return Err("Invalid contract date".into());
                }
                let area = row["area"]
                    .as_f64()
                    .filter(|a| a.is_finite() && *a > 0.0)
                    .ok_or("Invalid contract area")?;
                if !apartments.contains_key(id) {
                    if !shard_ids.contains_key(shard) {
                        shard_order.push(shard.clone());
                    }
                    shard_ids.entry(shard.clone()).or_default().push(id.clone());
                    apartments.insert(
                        id.clone(),
                        Apartment {
                            shard: shard.clone(),
                            districts: Vec::new(),
                            count: 0,
                            rank: apartments.len(),
                        },
                    );
                }
                let a = apartments.get_mut(id).unwrap();
                if a.shard != *shard {
                    return Err("Conflicting apartment shard mapping".into());
                }
                if !a.districts.contains(&p.lawd) {
                    a.districts.push(p.lawd.clone());
                }
                a.count += 1;
                linked += 1;
                insert.execute(params![linked, a.rank as i64, date, area, js(&row)?])?;
                area_insert.execute(params![a.rank as i64, area])?;
                Ok(())
            })?;
            if count != p.count {
                return Err(format!("Contract count mismatch: {}", p.path).into());
            }
            if hash(&path)? != source_hash {
                return Err("Contract changed during read".into());
            }
        }
        drop(insert);
        drop(area_insert);
        tx.commit()?;
    }
    // SQLite external sort spills to disk; payload is fetched one row at a time.
    db.execute_batch("CREATE INDEX output_order ON rows(apt,date DESC,seq)")?;
    js_order(&mut shard_order);
    let mut shard_hashes = json!({});
    let mut rows = db.prepare(
        "SELECT payload FROM rows INDEXED BY output_order WHERE apt=? ORDER BY date DESC,seq",
    )?;
    let mut areas = db.prepare("SELECT area FROM areas WHERE apt=? ORDER BY area")?;
    let mut record_file = BufWriter::new(File::create(scratch.0.join("records.json"))?);
    record_file.write_all(b"{")?;
    let mut first_record = true;
    for shard in &shard_order {
        let ids = shard_ids.get_mut(shard).unwrap();
        js_order(ids);
        let path = scratch.0.join(format!("{shard}.json"));
        let mut out = BufWriter::new(File::create(&path)?);
        out.write_all(b"{")?;
        for (i, id) in ids.iter().enumerate() {
            let a = &apartments[id];
            if i > 0 {
                out.write_all(b",")?;
            }
            serde_json::to_writer(&mut out, id)?;
            out.write_all(b":{\"rows\":[")?;
            let mut cursor = rows.query([a.rank as i64])?;
            let mut first = true;
            while let Some(row) = cursor.next()? {
                if !first {
                    out.write_all(b",")?;
                }
                first = false;
                let payload: String = row.get(0)?;
                out.write_all(payload.as_bytes())?;
            }
            out.write_all(b"],\"districts\":")?;
            serde_json::to_writer(&mut out, &a.districts)?;
            out.write_all(b"}")?;
            // Records object follows JS shard then apartment enumeration order.
            if !first_record {
                record_file.write_all(b",")?;
            }
            first_record = false;
            serde_json::to_writer(&mut record_file, id)?;
            record_file.write_all(b":{\"shard\":")?;
            serde_json::to_writer(&mut record_file, shard)?;
            record_file.write_all(b",\"areas\":[")?;
            let mut cursor = areas.query([a.rank as i64])?;
            let mut first = true;
            while let Some(row) = cursor.next()? {
                if !first {
                    record_file.write_all(b",")?;
                }
                first = false;
                js_write(&mut record_file, &json!(row.get::<_, f64>(0)?))?;
            }
            record_file.write_all(b"],\"districts\":")?;
            serde_json::to_writer(&mut record_file, &a.districts)?;
            write!(record_file, ",\"count\":{}}}", a.count)?;
        }
        out.write_all(b"}")?;
        out.flush()?;
        shard_hashes[format!("data/apartment-rent/{shard}.json")] = json!(hash(&path)?);
    }
    record_file.write_all(b"}")?;
    record_file.flush()?;
    let mut index = BufWriter::new(File::create(scratch.0.join("index.json"))?);
    write!(
        index,
        "{{\"schema\":1,\"unit\":\"만원\",\"total\":{total},\"linked\":{linked},\"records\":"
    )?;
    // Numeric IDs require global ECMAScript key enumeration; real catalog IDs are
    // strings, but support index keys too without loading transaction payloads.
    if apartments.keys().any(|id| array_index(id).is_some()) {
        let records: Value =
            serde_json::from_reader(BufReader::new(File::open(scratch.0.join("records.json"))?))?;
        js_write(&mut index, &records)?;
    } else {
        std::io::copy(&mut File::open(scratch.0.join("records.json"))?, &mut index)?;
    }
    for (key, value) in [
        ("coverage", coverage),
        ("shards", shard_hashes),
        ("sources", sources),
        ("contractsHash", json!(contracts_hash)),
        ("catalogHash", json!(catalog_hash)),
    ] {
        write!(index, ",\"{key}\":")?;
        js_write(&mut index, &value)?;
    }
    index.write_all(b"}")?;
    index.flush()?;
    if hash(&catalog_path)? != catalog_hash || hash(&manifest_path)? != contracts_hash {
        return Err("Input metadata changed".into());
    }
    let destination = safe(&root, "data/apartment-rent")?;
    let mut names: Vec<_> = shard_order.iter().map(|s| format!("{s}.json")).collect();
    names.push("index.json".into());
    for name in &names {
        safe(&root, &format!("data/apartment-rent/{name}"))?;
    }
    if request.verify {
        for name in &names {
            if hash(&destination.join(name))? != hash(&scratch.0.join(name))? {
                return Err(format!("Rent output out of date: {name}").into());
            }
        }
    } else {
        fs::create_dir_all(&destination)?;
        for name in &names {
            fs::copy(scratch.0.join(name), destination.join(name))?;
        }
    }
    Ok(
        json!({"total":total,"linked":linked,"apartments":apartments.len(),"files":names.len(),"verified":request.verify}),
    )
}
