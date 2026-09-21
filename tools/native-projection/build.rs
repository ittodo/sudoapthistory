use sha2::{Digest,Sha256};
fn main(){
 let mut hash=Sha256::new();
 for path in ["Cargo.toml","Cargo.lock","src/main.rs","vendor/daily.rs","vendor/rental.rs","vendor/month_ledger.rs","vendor/apartment_rent.rs","vendor/pipeline_guard.rs"]{
  println!("cargo:rerun-if-changed={path}");hash.update(path);hash.update(std::fs::read(path).expect("Missing build source"));
 }
 println!("cargo:rustc-env=NODO_SOURCE_SHA={:x}",hash.finalize());
}
