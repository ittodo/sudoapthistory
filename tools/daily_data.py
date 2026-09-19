"""Exact-area daily sales export. All database connections are read-only.

Rows: [areaId,date,price,floor,flags,previousDate,previousMin,high,low,records,id]
flags: direct=1,cancelled=2,missing=4. records: high=1,low=2,down=4,
equalHigh=8,equalLow=16,first=32. State: [areaId,date,min,max,mean,count].
"""
import argparse
from collections import defaultdict
from datetime import date, datetime, timezone
from decimal import Decimal
import hashlib
import gzip
from itertools import groupby
import json
from pathlib import Path
import sqlite3


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def area_key(value):
    value = Decimal(str(value))
    if not value.is_finite() or value <= 0:
        raise ValueError('Invalid area')
    return format(value.normalize(), 'f')


def classify(price, previous):
    if previous is None:
        return 32
    _, prev_min, high, low = previous
    return ((1 if price > high else 8 if price == high else 0)
            | (2 if price < low else 16 if price == low else 0)
            | (4 if price < prev_min else 0))


def advance(previous, day, prices):
    low, high = min(prices), max(prices)
    return [day, low, max(high, previous[2]) if previous else high,
            min(low, previous[3]) if previous else low]


def build(site, database, missing=None, guard=None):
    site, database = Path(site), Path(database)
    if guard:
        policy = read(guard)
        if not policy.get('site_publish_allowed') or policy.get('projection_in_progress'):
            raise ValueError('Daily generation blocked by source transition policy')
    map_path = site / 'data/map/index.json'
    map_data = read(map_path)
    source_map = {s['id']: c for c in map_data['d']
                  for s in c.get('memberSources', [{'id': c['id']}])}
    sources = {'data/map/index.json': digest(map_path)}
    conn = sqlite3.connect(database.resolve().as_uri() + '?mode=ro', uri=True)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA query_only=ON')
    conn.execute('BEGIN')
    meta = dict(conn.execute('SELECT key,value FROM build_meta'))
    if meta.get('trade_projection_status') != 'complete':
        raise ValueError('Daily generation requires a completed API projection')
    revision = meta.get('trade_source_revision')
    complexes, by_source = [], {}
    regions = {'경기': 0, '서울': 1, '인천': 2}
    for raw in conn.execute('SELECT * FROM canonical_complex ORDER BY apt_seq'):
        r = dict(raw)
        if r['region'] not in regions:
            continue
        c = source_map.get(r['apt_seq'], {})
        by_source[r['apt_seq']] = len(complexes)
        complexes.append({'id': r['apt_seq'], 'mapId': c.get('id'),
                          'publicId': c.get('publicationId') or c.get('id') or r['apt_seq'],
                          'n': r['complex_name'], 'r': regions[r['region']], 'g': r['gu'],
                          'd': r['dong'], 'coord': c.get('coord'), 'b': c.get('b'),
                          'tu': c.get('tu'), 'admin': c.get('admin', [])})
    fields = ('apt_seq,area,year,month,contract_day,price,floor,dealing_type,'
              'source_lawd_cd,source_deal_ymd,source_page_no,source_item_no,detail_fingerprint')
    queries = [f'SELECT {fields},0 AS inactive FROM transactions WHERE price>0 AND area>0',
               f'SELECT {fields},2 AS inactive FROM cancelled_transactions WHERE price>0 AND area>0']
    if missing and Path(missing).exists():
        conn.execute('ATTACH DATABASE ? AS gone', (Path(missing).resolve().as_uri() + '?mode=ro',))
        queries.append(f"SELECT {fields},4 AS inactive FROM gone.disappeared_transactions "
                       "WHERE source_state='missing' AND price>0 AND area>0")
    cursor = conn.execute(' UNION ALL '.join(queries) +
                          ' ORDER BY year,month,contract_day,apt_seq,area,price,floor,source_page_no,source_item_no')
    areas, area_ids, history, states = [], {}, {}, [{}, {}, {}]
    files, summaries, months, counts = {}, {}, [], defaultdict(int)
    current_month, rows, updates, opening = None, [[], [], []], [[], [], []], [[], [], []]
    min_date, max_date = None, None

    def write(relative, value):
        compressed = relative != 'data/daily/index.json'
        if compressed:
            relative = relative.removesuffix('.json') + '.bin'
        path = site / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        content = json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()
        if compressed:
            content = gzip.compress(content, compresslevel=6, mtime=0)
        if len(content) > 24 * 1024 * 1024:
            raise ValueError(f'Daily shard exceeds size budget: {relative}')
        path.write_bytes(content)
        files[relative] = hashlib.sha256(content).hexdigest()

    def flush():
        if current_month is None:
            return
        months.append(current_month)
        for region in range(3):
            write(f'data/daily/{region}/{current_month}.json', {'rows': rows[region]})
            write(f'data/daily/{region}/{current_month}-state.json',
                  {'opening': opening[region], 'updates': updates[region]})
        print(f'daily {current_month}: {sum(map(len, rows)):,} rows', flush=True)

    for day_parts, items in groupby(cursor, lambda r: (r['year'], r['month'], r['contract_day'])):
        try:
            iso = date(*day_parts).isoformat()
        except (ValueError, TypeError):
            counts['invalidDate'] += sum(1 for _ in items)
            continue
        if iso > date.today().isoformat():
            counts['futureDate'] += sum(1 for _ in items)
            continue
        month = iso[:7]
        if month != current_month:
            flush()
            # Keep empty calendar months usable for replay, with their carried state.
            if current_month:
                y, m = map(int, current_month.split('-'))
                while True:
                    y, m = (y + 1, 1) if m == 12 else (y, m + 1)
                    if f'{y:04d}-{m:02d}' >= month:
                        break
                    current_month = f'{y:04d}-{m:02d}'
                    rows, updates = [[], [], []], [[], [], []]
                    opening = [list(s.values()) for s in states]
                    flush()
            current_month = month
            rows, updates = [[], [], []], [[], [], []]
            opening = [list(s.values()) for s in states]
        day = int(iso.replace('-', ''))
        prices_by_area = defaultdict(list)
        for raw in items:
            r = dict(raw)
            ci = by_source.get(r['apt_seq'])
            if ci is None:
                counts['unresolvedSource'] += 1
                continue
            key = (ci, area_key(r['area']))
            if key not in area_ids:
                area_ids[key] = len(areas)
                areas.append(list(key))
            ai = area_ids[key]
            c = complexes[ci]
            flags = r['inactive'] | (1 if r['dealing_type'] == '직거래' else 0)
            prev = history.get(ai)
            records = classify(r['price'], prev) if flags == 0 else 0
            identity = '|'.join(str(r[k] or '') for k in ('apt_seq', 'source_lawd_cd',
                'source_deal_ymd', 'source_page_no', 'source_item_no', 'detail_fingerprint', 'inactive'))
            rid = hashlib.sha256(identity.encode()).hexdigest()[:24]
            rows[c['r']].append([ai, day, r['price'], r['floor'], flags,
                prev[0] if prev and flags == 0 else None, prev[1] if prev and flags == 0 else None,
                prev[2] if prev and flags == 0 else None, prev[3] if prev and flags == 0 else None,
                records, rid])
            counts['rows'] += 1
            if flags & 6:
                counts['inactive'] += 1
                continue
            counts['active'] += 1
            min_date = iso if min_date is None else min(min_date, iso)
            max_date = iso if max_date is None else max(max_date, iso)
            summary = summaries.setdefault(iso, [0, 0, 0, 0])
            summary[0] += 1
            summary[1] += bool(records & 1)
            summary[2] += bool(records & 4)
            summary[3] += bool(records & 2)
            if flags == 0:
                prices_by_area[ai].append(r['price'])
        for ai, prices in prices_by_area.items():
            history[ai] = advance(history.get(ai), day, prices)
            state = [ai, day, min(prices), max(prices), round(sum(prices) / len(prices), 4), len(prices)]
            region = complexes[areas[ai][0]]['r']
            states[region][ai] = state
            updates[region].append(state)
    flush()
    conn.commit()
    final_meta = dict(conn.execute('SELECT key,value FROM build_meta'))
    conn.close()
    if revision != final_meta.get('trade_source_revision') or final_meta.get('trade_projection_status') != 'complete':
        raise ValueError('Projection changed during daily export; rebuild required')
    if sources['data/map/index.json'] != digest(map_path):
        raise ValueError('Map changed during daily export; rebuild required')
    if not max_date:
        raise ValueError('No active daily transactions')
    write('data/daily/catalog.json', {'complexes': complexes, 'areas': areas})
    sources.update(files)
    version = hashlib.sha256(json.dumps(sources, sort_keys=True).encode()).hexdigest()[:16]
    result = {'schema': 1, 'encoding': 'gzip-json', 'version': version, 'updated': datetime.now(timezone.utc).isoformat(),
              'sourceRevision': revision, 'mapVersion': map_data['meta']['sourceVersion'],
              'minDate': min_date, 'maxDate': max_date, 'months': months,
              'counts': dict(counts), 'summary': summaries, 'sources': sources}
    write('data/daily/index.json', result)
    return result


def validate(site):
    site = Path(site)
    data = read(site / 'data/daily/index.json')
    for path, expected in data['sources'].items():
        if digest(site / path) != expected:
            raise ValueError(f'Daily source changed: {path}')
    return {'version': data['version'], **data['counts']}


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--site', type=Path, default=Path(__file__).resolve().parents[1])
    p.add_argument('--database', type=Path, default=Path('D:/Work/15_26/apt_data.db'))
    p.add_argument('--missing', type=Path, default=Path('D:/Work/15_26/snapshots/trade_disappearance.db'))
    p.add_argument('--guard', type=Path, default=Path('D:/Work/15_26/data/trade_source_transition.json'))
    p.add_argument('--verify', action='store_true')
    args = p.parse_args()
    if not args.verify:
        build(args.site, args.database, args.missing, args.guard)
    print(json.dumps(validate(args.site), ensure_ascii=False))
