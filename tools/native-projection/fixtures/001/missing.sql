BEGIN TRANSACTION;
CREATE TABLE disappeared_transactions(apt_seq TEXT,area REAL,year INT,month INT,contract_day INT,price INT,floor INT,dealing_type TEXT,source_lawd_cd TEXT,source_deal_ymd TEXT,source_page_no INT,source_item_no INT,detail_fingerprint TEXT,source_state TEXT);
INSERT INTO "disappeared_transactions" VALUES('A',84.9,2026,1,7,3,3,'','11','202601',1,100,'gone','missing');
COMMIT;