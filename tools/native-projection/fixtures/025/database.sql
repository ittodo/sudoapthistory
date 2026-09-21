BEGIN TRANSACTION;
CREATE TABLE build_meta(key TEXT,value TEXT);
INSERT INTO "build_meta" VALUES('trade_projection_status','complete');
INSERT INTO "build_meta" VALUES('trade_source_revision','v1');
CREATE TABLE cancelled_transactions(
  apt_seq TEXT,
  area REAL,
  year INT,
  month INT,
  contract_day INT,
  price INT,
  floor INT,
  dealing_type TEXT,
  source_lawd_cd TEXT,
  source_deal_ymd TEXT,
  source_page_no INT,
  source_item_no INT,
  detail_fingerprint TEXT
);
CREATE TABLE canonical_complex(apt_seq TEXT,region TEXT,complex_name TEXT,gu TEXT,dong TEXT);
INSERT INTO "canonical_complex" VALUES('A','서울','A','구','동');
CREATE TABLE transactions(apt_seq TEXT,area REAL,year INT,month INT,contract_day INT,price INT,floor INT,dealing_type TEXT,source_lawd_cd TEXT,source_deal_ymd TEXT,source_page_no INT,source_item_no INT,detail_fingerprint TEXT);
INSERT INTO "transactions" VALUES('A',84.9,2025,12,0,1,3,'','11','202512',1,0,'0');
INSERT INTO "transactions" VALUES('A',84.9,2025,12,31,100,3,'','11','202512',1,31,'31');
INSERT INTO "transactions" VALUES('A',84.9,2026,1,5,90,3,'','11','202601',1,5,'5');
INSERT INTO "transactions" VALUES('A',84.9,2026,1,10,120,3,'','11','202601',1,10,'10');
COMMIT;