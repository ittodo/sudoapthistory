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
INSERT INTO "cancelled_transactions" VALUES('A',84.9,2026,1,4,5,3,'','11','202601',1,99,'cancel');
CREATE TABLE canonical_complex(apt_seq TEXT,region TEXT,complex_name TEXT,gu TEXT,dong TEXT);
INSERT INTO "canonical_complex" VALUES('A','서울','같은 이름','중구','동1');
INSERT INTO "canonical_complex" VALUES('B','인천','같은 이름','중구','동2');
CREATE TABLE transactions(apt_seq TEXT,area REAL,year INT,month INT,contract_day INT,
                    price INT,floor INT,dealing_type TEXT,source_lawd_cd TEXT,source_deal_ymd TEXT,
                    source_page_no INT,source_item_no INT,detail_fingerprint TEXT);
INSERT INTO "transactions" VALUES('A',84.9,2025,12,31,100,3,'','11','202512',1,0,'0');
INSERT INTO "transactions" VALUES('A',84.9,2025,12,31,120,3,'','11','202512',1,1,'1');
INSERT INTO "transactions" VALUES('A',84.9,2026,1,1,110,3,'','11','202601',1,2,'2');
INSERT INTO "transactions" VALUES('A',84.9,2026,1,2,90,3,'','11','202601',1,3,'3');
INSERT INTO "transactions" VALUES('A',84.9,2026,1,2,130,3,'','11','202601',1,4,'4');
INSERT INTO "transactions" VALUES('A',84.9,2026,1,3,20,3,'직거래','11','202601',1,5,'5');
INSERT INTO "transactions" VALUES('A',84.9,2026,1,5,95,3,'','11','202601',1,6,'6');
INSERT INTO "transactions" VALUES('A',84.95,2026,1,6,80,3,'','11','202601',1,7,'7');
INSERT INTO "transactions" VALUES('B',84.9,2026,1,6,50,3,'','11','202601',1,8,'8');
INSERT INTO "transactions" VALUES('A',84.9,2026,2,1,89,3,'','11','202602',1,9,'9');
INSERT INTO "transactions" VALUES('A',84.9,2026,2,0,1,3,'','11','202602',1,10,'10');
COMMIT;