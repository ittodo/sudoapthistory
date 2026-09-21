BEGIN TRANSACTION;
CREATE TABLE disappeared_transactions(apt_seq TEXT,area REAL,year INT,month INT,contract_day INT,price INT,floor INT,dealing_type TEXT,source_lawd_cd TEXT,source_deal_ymd TEXT,source_page_no INT,source_item_no INT,detail_fingerprint TEXT,source_state TEXT);
INSERT INTO "disappeared_transactions" VALUES('A',84.9,2026,1,7,3,3,'','11','202601',1,100,'gone','missing');
CREATE TABLE month_ledger(
        kind TEXT, region TEXT, year INT, month INT, digest TEXT, rows INT,
        PRIMARY KEY(kind,region,year,month));
INSERT INTO "month_ledger" VALUES('disappeared_transactions','11',2026,1,'3ac727700c37a95466110ae05254810f7dad9df970c9534e5f88fa893b560e45',1);
CREATE TABLE month_ledger_dirty(
        kind TEXT,year INT,month INT,PRIMARY KEY(kind,year,month));
CREATE TABLE month_ledger_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
INSERT INTO "month_ledger_meta" VALUES('version','2');
INSERT INTO "month_ledger_meta" VALUES('epoch','8926bcc545b54150bcb267a3b11082bf');
INSERT INTO "month_ledger_meta" VALUES('triggers','265be2e5a25a45c2992799b60f1602d7ff999713b24297fd395c4bda47c82dce');
INSERT INTO "month_ledger_meta" VALUES('complete','1');
CREATE INDEX ml_disappeared_transactions_ym ON disappeared_transactions(year,month);
CREATE TRIGGER ml_disappeared_transactions_insert AFTER INSERT ON disappeared_transactions BEGIN INSERT OR IGNORE INTO month_ledger_dirty VALUES('disappeared_transactions',COALESCE(NEW.year,0),COALESCE(NEW.month,0)); END;
CREATE TRIGGER ml_disappeared_transactions_delete AFTER DELETE ON disappeared_transactions BEGIN INSERT OR IGNORE INTO month_ledger_dirty VALUES('disappeared_transactions',COALESCE(OLD.year,0),COALESCE(OLD.month,0)); END;
CREATE TRIGGER ml_disappeared_transactions_update AFTER UPDATE ON disappeared_transactions WHEN OLD.apt_seq IS NOT NEW.apt_seq OR OLD.area IS NOT NEW.area OR OLD.year IS NOT NEW.year OR OLD.month IS NOT NEW.month OR OLD.contract_day IS NOT NEW.contract_day OR OLD.price IS NOT NEW.price OR OLD.floor IS NOT NEW.floor OR OLD.dealing_type IS NOT NEW.dealing_type OR OLD.source_lawd_cd IS NOT NEW.source_lawd_cd OR OLD.source_deal_ymd IS NOT NEW.source_deal_ymd OR OLD.source_page_no IS NOT NEW.source_page_no OR OLD.source_item_no IS NOT NEW.source_item_no OR OLD.detail_fingerprint IS NOT NEW.detail_fingerprint OR OLD.source_state IS NOT NEW.source_state BEGIN INSERT OR IGNORE INTO month_ledger_dirty VALUES('disappeared_transactions',COALESCE(OLD.year,0),COALESCE(OLD.month,0));INSERT OR IGNORE INTO month_ledger_dirty VALUES('disappeared_transactions',COALESCE(NEW.year,0),COALESCE(NEW.month,0)); END;
COMMIT;