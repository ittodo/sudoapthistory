use sha2::{Digest,Sha256};
fn main(){
 let mut hash=Sha256::new();
 for path in ["Cargo.toml","Cargo.lock","src/main.rs","vendor/daily.rs","vendor/rental.rs","vendor/month_ledger.rs","vendor/apartment_rent.rs","vendor/pipeline_guard.rs","vendor/regional.rs","vendor/calc_suffix.rs"]{
  println!("cargo:rerun-if-changed={path}");hash.update(path);hash.update(std::fs::read(path).expect("Missing build source"));
 }
 let proof=format!("{:x}",hash.finalize());
 println!("cargo:rustc-env=NODO_SOURCE_SHA={proof}");
 println!("cargo:rustc-env=NODO_GENERATION_SHA={proof}");
}
