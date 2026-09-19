import contextlib
import gzip
import io
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
import shutil
import daily_data as d
from unittest.mock import patch

from daily_data import area_key, build, validate


class DailyExportTest(unittest.TestCase):
    def test_exact_area_history_ties_cancellations_and_restatement(self):
        with tempfile.TemporaryDirectory(prefix='nodo-daily-test-') as temporary:
            root = Path(temporary)
            (root / 'data/map').mkdir(parents=True)
            (root / 'data/map/index.json').write_text(json.dumps({'meta': {'sourceVersion': 'fixture'}, 'd': []}))
            database = root / 'source.db'
            c = sqlite3.connect(database)
            c.executescript('''
                CREATE TABLE build_meta(key TEXT,value TEXT);
                INSERT INTO build_meta VALUES('trade_projection_status','complete'),('trade_source_revision','v1');
                CREATE TABLE canonical_complex(apt_seq TEXT,region TEXT,complex_name TEXT,gu TEXT,dong TEXT);
                INSERT INTO canonical_complex VALUES('A','서울','같은 이름','중구','동1'),('B','인천','같은 이름','중구','동2');
                CREATE TABLE transactions(apt_seq TEXT,area REAL,year INT,month INT,contract_day INT,
                    price INT,floor INT,dealing_type TEXT,source_lawd_cd TEXT,source_deal_ymd TEXT,
                    source_page_no INT,source_item_no INT,detail_fingerprint TEXT);
                CREATE TABLE cancelled_transactions AS SELECT * FROM transactions WHERE 0;
            ''')
            events = [('A',84.9,2025,12,31,100,''),('A',84.9,2025,12,31,120,''),
                      ('A',84.9,2026,1,1,110,''),('A',84.9,2026,1,2,90,''),
                      ('A',84.9,2026,1,2,130,''),('A',84.9,2026,1,3,20,'직거래'),
                      ('A',84.9,2026,1,5,95,''),('A',84.95,2026,1,6,80,''),
                      ('B',84.9,2026,1,6,50,''),('A',84.9,2026,2,1,89,''),
                      ('A',84.9,2026,2,0,1,'')]
            for i, (source,area,y,m,d,p,kind) in enumerate(events):
                c.execute('INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
                          (source,area,y,m,d,p,3,kind,'11',f'{y}{m:02}',1,i,str(i)))
            c.execute("INSERT INTO cancelled_transactions VALUES('A',84.9,2026,1,4,5,3,'','11','202601',1,99,'cancel')")
            c.commit()

            def run():
                with contextlib.redirect_stdout(io.StringIO()):
                    return build(root,database)

            def data(name):
                return json.loads(gzip.decompress((root / ('data/daily/'+name+'.bin')).read_bytes()))

            index=run()
            self.assertEqual(index['counts']['active'],10)
            self.assertEqual(index['counts']['invalidDate'],1)
            january=data('1/2026-01')['rows']
            by_price={r[2]:r for r in january}
            self.assertEqual(by_price[90][5:10],[20260101,110,120,100,6])
            self.assertEqual(by_price[130][5:10],[20260101,110,120,100,1])
            self.assertEqual(by_price[95][5:10],[20260102,90,130,90,0])
            self.assertEqual(by_price[20][4],1)
            self.assertEqual(by_price[20][9],0)
            self.assertEqual(by_price[5][4],2)
            self.assertEqual(by_price[80][9],32)
            self.assertNotEqual(by_price[80][0],by_price[95][0])
            self.assertEqual(data('2/2026-01')['rows'][0][9],32)
            feb=data('1/2026-02')['rows'][0]
            self.assertEqual(feb[5:10],[20260105,95,130,90,6])
            opening=data('1/2026-01-state')['opening'][0]
            self.assertEqual(opening[1:],[20251231,100,120,110,2])
            self.assertTrue(all(s[1]<20260101 for s in data('1/2026-01-state')['opening']))
            self.assertFalse(any(s[1] in (20260103,20260104) for s in data('1/2026-01-state')['updates']))
            self.assertEqual(validate(root)['active'],10)
            original_files = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in (root / 'data/daily').rglob('*') if p.is_file()}
            with patch('daily_data.gzip.compress', side_effect=AssertionError('unchanged content must not be recompressed')):
                repeated = run()
            self.assertEqual(index, repeated)
            for path, (content, mtime) in original_files.items():
                self.assertEqual(path.read_bytes(), content)
                self.assertEqual(path.stat().st_mtime_ns, mtime)
            # The previous publication is reusable by a fresh isolated release.
            stage = root / 'stage'
            (stage / 'data/map').mkdir(parents=True)
            (stage / 'data/map/index.json').write_bytes((root / 'data/map/index.json').read_bytes())
            with patch('daily_data.gzip.compress', side_effect=AssertionError('cross-stage cache miss')), contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(build(stage,database,previous_site=root),index)
            damaged = root / 'data/daily/1/2026-01.bin'
            damaged.write_bytes(b'corrupt')
            run()
            self.assertEqual(damaged.read_bytes(),original_files[damaged][0])
            c.execute('UPDATE transactions SET price=75 WHERE price=90')
            c.execute("UPDATE build_meta SET value='v2' WHERE key='trade_source_revision'")
            c.commit()
            run()
            self.assertEqual(data('1/2026-02')['rows'][0][9],4,'past corrections must remove obsolete record-low badge')
            c.close()

    def test_decimal_normalization(self):
        self.assertEqual(area_key('84.9000'),'84.9')
        self.assertNotEqual(area_key('84.90'),area_key('84.95'))
        with self.assertRaises(ValueError):area_key('NaN')


if __name__=='__main__':unittest.main()
class CheckpointTests(unittest.TestCase):

    def test_recent_edits_historical_correction_and_corruption_match_full(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            site = root / 'site'
            (site / 'data/map').mkdir(parents=True)
            (site / 'data/map/index.json').write_text(json.dumps({'meta': {'sourceVersion': 'v1'}, 'd': []}))
            db = root / 'fixture.db'
            c = sqlite3.connect(db)
            c.executescript("CREATE TABLE build_meta(key TEXT,value TEXT);\n   INSERT INTO build_meta VALUES('trade_projection_status','complete'),('trade_source_revision','v1');\n   CREATE TABLE canonical_complex(apt_seq TEXT,region TEXT,complex_name TEXT,gu TEXT,dong TEXT);\n   INSERT INTO canonical_complex VALUES('A','서울','A','구','동');\n   CREATE TABLE transactions(apt_seq TEXT,area REAL,year INT,month INT,contract_day INT,price INT,floor INT,dealing_type TEXT,source_lawd_cd TEXT,source_deal_ymd TEXT,source_page_no INT,source_item_no INT,detail_fingerprint TEXT);\n   CREATE TABLE cancelled_transactions AS SELECT * FROM transactions WHERE 0;")
            for y, m, day, price in [(2025, 12, 0, 1), (2025, 12, 31, 100), (2026, 1, 5, 90), (2026, 1, 10, 120)]:
                c.execute('INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', ('A', 84.9, y, m, day, price, 3, '', '11', str(y * 100 + m), 1, day, str(day)))
            c.commit()
            cache = root / 'cache'

            def run():
                out = io.StringIO()
                with contextlib.redirect_stdout(out):
                    result = d.build(site, db, cache_dir=cache)
                return (result, out.getvalue())
            run()
            run()

            def compare(expected):
                result, log = run()
                self.assertIn('daily checkpoint: ' + expected, log)
                other = root / 'full'
                (other / 'data/map').mkdir(parents=True, exist_ok=True)
                shutil.copyfile(site / 'data/map/index.json', other / 'data/map/index.json')
                with contextlib.redirect_stdout(io.StringIO()):
                    full = d.build(other, db)
                self.assertEqual({k: v for k, v in result.items() if k != 'updated'}, {k: v for k, v in full.items() if k != 'updated'})
                for name in result['sources']:
                    self.assertEqual((site / name).read_bytes(), (other / name).read_bytes(), name)
                d.validate(site)
            compare('reused')
            c.execute('UPDATE transactions SET price=80 WHERE year=2026 AND contract_day=10')
            c.commit()
            compare('reused')
            c.execute('UPDATE transactions SET price=70 WHERE year=2025 AND contract_day=31')
            c.commit()
            compare('full')
            compare('reused')
            c.execute('INSERT INTO cancelled_transactions SELECT * FROM transactions WHERE year=2025 AND contract_day=31')
            c.execute('DELETE FROM transactions WHERE year=2025 AND contract_day=31')
            c.commit()
            compare('full')
            compare('reused')
            next(cache.glob('*.json')).write_text('{broken')
            compare('full')
            (site / 'data/daily/1/2025-12.bin').write_bytes(b'broken')
            compare('full')
            c.execute("INSERT INTO transactions VALUES('A',84.95,2026,3,1,200,4,'','11','202603',1,1,'new')")
            c.commit()
            compare('reused')
            compare('full')
            compare('reused')
            c.close()
