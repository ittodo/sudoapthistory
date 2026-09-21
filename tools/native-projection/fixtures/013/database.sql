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
INSERT INTO "canonical_complex" VALUES('C','경기','경기 단지','시','동');
INSERT INTO "canonical_complex" VALUES('X','제주','제외','시','동');
CREATE TABLE month_ledger(
        kind TEXT, region TEXT, year INT, month INT, digest TEXT, rows INT,
        PRIMARY KEY(kind,region,year,month));
INSERT INTO "month_ledger" VALUES('cancelled_transactions','11',2026,1,'bdce3ef9133f8cf66c482000483ace196af69f2903dde7738d0d857e51cb0b88',1);
INSERT INTO "month_ledger" VALUES('transactions','11',2026,1,'f56675b87289a6e0ddfd09f66d61ddd7b3e6ce228faa2da286ebd0bf4019617b',7);
INSERT INTO "month_ledger" VALUES('transactions','11',2026,3,'e23f7cb15fb07b248104cdbc45f2b6f7e7890dcad10aec0b8f75ff9054672ab5',4);
INSERT INTO "month_ledger" VALUES('transactions','11',2025,12,'e8dc582b68c64f96d7e30b2b116743b703d28bcc856b01d0fe34e944cf9cc08c',2);
CREATE TABLE month_ledger_dirty(
        kind TEXT,year INT,month INT,PRIMARY KEY(kind,year,month));
INSERT INTO "month_ledger_dirty" VALUES('transactions',2025,12);
CREATE TABLE month_ledger_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
INSERT INTO "month_ledger_meta" VALUES('version','2');
INSERT INTO "month_ledger_meta" VALUES('epoch','b282ac4cb8824b3aa32539405a629c1b');
INSERT INTO "month_ledger_meta" VALUES('triggers','0f694cfbfa500a104480f6a68f494a24d6301e0ec3945ba0d6ff0321920a38ca');
INSERT INTO "month_ledger_meta" VALUES('complete','1');
CREATE TABLE transactions(apt_seq TEXT,area REAL,year INT,month INT,contract_day INT,
                price INT,floor INT,dealing_type TEXT,source_lawd_cd TEXT,source_deal_ymd TEXT,
                source_page_no INT,source_item_no INT,detail_fingerprint TEXT);
INSERT INTO "transactions" VALUES('A',84.9,2025,12,31,77,3,'','11','202512',1,0,'0');
INSERT INTO "transactions" VALUES('A',84.9,2025,12,31,120,3,'','11','202512',1,1,'1');
INSERT INTO "transactions" VALUES('A',84.9,2026,1,1,110,3,'','11','202601',1,2,'2');
INSERT INTO "transactions" VALUES('A',84.9,2026,1,2,90,3,'','11','202601',1,3,'3');
INSERT INTO "transactions" VALUES('A',84.9,2026,1,2,130,3,'','11','202601',1,4,'4');
INSERT INTO "transactions" VALUES('A',84.9,2026,1,3,20,3,'직거래','11','202601',1,5,'5');
INSERT INTO "transactions" VALUES('A',84.9,2026,1,5,95,3,'','11','202601',1,6,'6');
INSERT INTO "transactions" VALUES('A',84.95,2026,1,6,80,3,'','11','202601',1,7,'7');
INSERT INTO "transactions" VALUES('B',84.9,2026,1,6,50,3,'','11','202601',1,8,'8');
INSERT INTO "transactions" VALUES('A',84.9,2026,3,1,89,3,'','11','202603',1,9,'9');
INSERT INTO "transactions" VALUES('C',59.0,2026,3,2,123.125,3,'','11','202603',1,10,'10');
INSERT INTO "transactions" VALUES('C',59.0,2026,3,2,456.875,3,'','11','202603',1,11,'11');
INSERT INTO "transactions" VALUES('unknown',84.9,2026,3,3,90,3,'','11','202603',1,12,'12');
CREATE INDEX ml_transactions_ym ON transactions(year,month);
CREATE TRIGGER ml_transactions_insert AFTER INSERT ON transactions BEGIN INSERT OR IGNORE INTO month_ledger_dirty VALUES('transactions',COALESCE(NEW.year,0),COALESCE(NEW.month,0)); END;
CREATE TRIGGER ml_transactions_delete AFTER DELETE ON transactions BEGIN INSERT OR IGNORE INTO month_ledger_dirty VALUES('transactions',COALESCE(OLD.year,0),COALESCE(OLD.month,0)); END;
CREATE TRIGGER ml_transactions_update AFTER UPDATE ON transactions WHEN OLD.apt_seq IS NOT NEW.apt_seq OR OLD.area IS NOT NEW.area OR OLD.year IS NOT NEW.year OR OLD.month IS NOT NEW.month OR OLD.contract_day IS NOT NEW.contract_day OR OLD.price IS NOT NEW.price OR OLD.floor IS NOT NEW.floor OR OLD.dealing_type IS NOT NEW.dealing_type OR OLD.source_lawd_cd IS NOT NEW.source_lawd_cd OR OLD.source_deal_ymd IS NOT NEW.source_deal_ymd OR OLD.source_page_no IS NOT NEW.source_page_no OR OLD.source_item_no IS NOT NEW.source_item_no OR OLD.detail_fingerprint IS NOT NEW.detail_fingerprint BEGIN INSERT OR IGNORE INTO month_ledger_dirty VALUES('transactions',COALESCE(OLD.year,0),COALESCE(OLD.month,0));INSERT OR IGNORE INTO month_ledger_dirty VALUES('transactions',COALESCE(NEW.year,0),COALESCE(NEW.month,0)); END;
CREATE INDEX ml_cancelled_transactions_ym ON cancelled_transactions(year,month);
CREATE TRIGGER ml_cancelled_transactions_insert AFTER INSERT ON cancelled_transactions BEGIN INSERT OR IGNORE INTO month_ledger_dirty VALUES('cancelled_transactions',COALESCE(NEW.year,0),COALESCE(NEW.month,0)); END;
CREATE TRIGGER ml_cancelled_transactions_delete AFTER DELETE ON cancelled_transactions BEGIN INSERT OR IGNORE INTO month_ledger_dirty VALUES('cancelled_transactions',COALESCE(OLD.year,0),COALESCE(OLD.month,0)); END;
CREATE TRIGGER ml_cancelled_transactions_update AFTER UPDATE ON cancelled_transactions WHEN OLD.apt_seq IS NOT NEW.apt_seq OR OLD.area IS NOT NEW.area OR OLD.year IS NOT NEW.year OR OLD.month IS NOT NEW.month OR OLD.contract_day IS NOT NEW.contract_day OR OLD.price IS NOT NEW.price OR OLD.floor IS NOT NEW.floor OR OLD.dealing_type IS NOT NEW.dealing_type OR OLD.source_lawd_cd IS NOT NEW.source_lawd_cd OR OLD.source_deal_ymd IS NOT NEW.source_deal_ymd OR OLD.source_page_no IS NOT NEW.source_page_no OR OLD.source_item_no IS NOT NEW.source_item_no OR OLD.detail_fingerprint IS NOT NEW.detail_fingerprint BEGIN INSERT OR IGNORE INTO month_ledger_dirty VALUES('cancelled_transactions',COALESCE(OLD.year,0),COALESCE(OLD.month,0));INSERT OR IGNORE INTO month_ledger_dirty VALUES('cancelled_transactions',COALESCE(NEW.year,0),COALESCE(NEW.month,0)); END;
COMMIT;