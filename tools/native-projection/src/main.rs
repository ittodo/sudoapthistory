#![allow(dead_code)]
#[path = "../vendor/apartment_rent.rs"] mod apartment_rent;
#[path = "../vendor/daily.rs"] mod daily;
#[path = "../vendor/rental.rs"] mod rental;
#[path = "../vendor/month_ledger.rs"] mod month_ledger;
#[path = "../vendor/pipeline_guard.rs"] mod pipeline_guard;
use std::io::{self,Read};
use serde_json::{json,Value};
type Result<T> = std::result::Result<T,Box<dyn std::error::Error+Send+Sync>>;
fn run()->Result<()> {
 let mut input=String::new();io::stdin().read_to_string(&mut input)?;
 let spec:Value=serde_json::from_str(&input)?;
 let result=match std::env::args().nth(1).as_deref(){
  Some("daily-build")=>daily::build(spec)?,
  Some("daily-validate")=>daily::validate(spec)?,
  Some("rental-build")=>rental::build(spec)?,
  Some("rental-validate")=>rental::validate(spec)?,
  Some("rental-rates")=>{if spec.get("response").is_none(){return Err("Offline fixture response required".into());}rental::rates(spec)?},
  _=>return Err("Only projection fixture commands are supported".into()),
 };
 println!("{}",json!({"schema":1,"result":result}));Ok(())
}
fn main(){if let Err(e)=run(){eprintln!("{e}");std::process::exit(1);}}
