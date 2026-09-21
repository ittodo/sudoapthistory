//! Existing collection/publication gates and interoperable first-byte writer lock.
use crate::Result;
use rusqlite::{Connection, OpenFlags};
use serde_json::{json, Value};
use std::{fs::{self, File, OpenOptions}, io::{Seek, SeekFrom, Write}, path::{Path, PathBuf}};

fn resolved(path: &Path) -> Result<PathBuf> {
    if path.exists() { return Ok(path.canonicalize()?); }
    let name = path.file_name().ok_or("Invalid output path")?;
    let parent = path.parent().ok_or("Output parent missing")?;
    Ok(resolved(parent)?.join(name))
}

pub fn root(spec: &Value) -> Result<PathBuf> {
    let value = spec.get("root").and_then(Value::as_str).ok_or("Explicit project root required")?;
    let root = Path::new(value).canonicalize()?;
    if !root.is_dir() { return Err("Project root must be a directory".into()); }
    Ok(root)
}

pub fn check(spec: &Value, action: &str) -> Result<Value> {
    let root = root(spec)?;
    let settings: Value = serde_json::from_slice(&fs::read(root.join("data/trade_source_transition.json"))?)?;
    if action == "status" { return Ok(settings); }
    for name in ["projection_in_progress", "site_publish_allowed"] {
        if settings.get(name).is_some_and(|v| !v.is_boolean()) { return Err(format!("Invalid boolean gate {name}").into()); }
    }
    let active = settings["mode"] == "active";
    let projecting = settings["projection_in_progress"].as_bool().unwrap_or(false);
    let publish = settings["site_publish_allowed"].as_bool().unwrap_or(false);
    match action {
        "collection" if !active || projecting => return Err("DEFERRED: trade source transition is in maintenance".into()),
        "site-write" if !active || projecting || !publish => return Err("Site apply/deploy disabled pending API-source validation and approval".into()),
        "build" => {
            let output = Path::new(spec["output"].as_str().ok_or("Build output required")?);
            let output = if output.is_absolute() { output.to_path_buf() } else { root.join(output) };
            let isolated = resolved(&output)?.starts_with(resolved(&root.join("_ops/trade-api-transition/shadow-site"))?);
            if (!active && !isolated) || projecting { return Err("DEFERRED: trade source transition is in maintenance".into()); }
            if !publish && !isolated { return Err("Build allowed only in isolated shadow-site until publication approval".into()); }
            let database = Path::new(spec["database"].as_str().ok_or("Build database required")?);
            let database = if database.is_absolute() { database.to_path_buf() } else { root.join(database) };
            let db = Connection::open_with_flags(database, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
            db.pragma_update(None, "query_only", true)?;
            let meta: std::collections::BTreeMap<String, String> = db.prepare("SELECT key,value FROM build_meta")?
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<std::result::Result<_, _>>()?;
            if meta.get("trade_source_contract").map(String::as_str) != Some("housing-detailed-api-v2") ||
               meta.get("trade_projection_status").map(String::as_str) != Some("complete") {
                return Err("Operating trade projection is not validated".into());
            }
        }
        "collection" | "site-write" => {},
        _ => return Err("Unknown pipeline guard action".into()),
    }
    Ok(json!({"allowed": true, "action": action}))
}

pub struct WriterLock { file: File }

impl WriterLock {
    pub fn acquire(path: &Path) -> Result<Self> {
        fs::create_dir_all(path.parent().ok_or("Lock parent missing")?)?;
        let mut file = OpenOptions::new().read(true).write(true).create(true).truncate(false).open(path)?;
        // A persistent byte-range lock interoperates with msvcrt.LK_NBLCK.
        os_lock(&file, true)?;
        if file.metadata()?.len() == 0 {
            file.seek(SeekFrom::Start(0))?;
            file.write_all(b"0")?;
            file.flush()?;
        }
        Ok(Self { file })
    }
}

impl Drop for WriterLock {
    fn drop(&mut self) { let _ = os_lock(&self.file, false); }
}

#[cfg(windows)]
fn os_lock(file: &File, acquire: bool) -> Result<()> {
    use std::os::windows::io::AsRawHandle;
    #[repr(C)]
    struct Overlapped { internal: usize, internal_high: usize, offset: u32, offset_high: u32, event: *mut std::ffi::c_void }
    #[link(name = "kernel32")]
    extern "system" {
        fn LockFileEx(file: *mut std::ffi::c_void, flags: u32, reserved: u32, low: u32, high: u32, state: *mut Overlapped) -> i32;
        fn UnlockFileEx(file: *mut std::ffi::c_void, reserved: u32, low: u32, high: u32, state: *mut Overlapped) -> i32;
    }
    let mut state = Overlapped { internal: 0, internal_high: 0, offset: 0, offset_high: 0, event: std::ptr::null_mut() };
    let ok = unsafe {
        if acquire { LockFileEx(file.as_raw_handle(), 3, 0, 1, 0, &mut state) }
        else { UnlockFileEx(file.as_raw_handle(), 0, 1, 0, &mut state) }
    };
    if ok == 0 { return Err(format!("DEFERRED: pipeline writer lock unavailable ({})", std::io::Error::last_os_error()).into()); }
    Ok(())
}

#[cfg(not(windows))]
fn os_lock(_file: &File, _acquire: bool) -> Result<()> {
    Err("Pipeline writer lock currently requires Windows".into())
}

