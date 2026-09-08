"""Build a version-bound map index from published static files; review DB is read-only."""
import argparse
import hashlib
import json
import math
import re
import sqlite3
from collections import defaultdict
from pathlib import Path


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def latest(years):
    trades = []
    for year, rows in years.items():
        for order, row in enumerate(rows):
            if len(row) < 4 or (len(row) > 4 and int(row[4] or 0) & 2):
                continue
            month, day, price, floor = row[:4]
            if not (1 <= month <= 12 and 1 <= day <= 31 and price > 0):
                continue
            trades.append([int(year) * 10000 + month * 100 + day, price, floor,
                           int(row[4] or 0) if len(row) > 4 else 0, order])
    if not trades:
        return None
    trades.sort(key=lambda t: (-t[0], t[4]))
    best = trades[0]
    return best[:4] + [sum(t[0] == best[0] for t in trades)]


def coordinates(value):
    if not isinstance(value, list) or not value:
        return
    if isinstance(value[0], (float, int)):
        if len(value) >= 2 and all(math.isfinite(n) for n in value[:2]):
            yield value[:2]
    else:
        for child in value:
            yield from coordinates(child)


def collection(raw):
    if raw.get('type') == 'FeatureCollection':
        return raw
    return raw.get('response', {}).get('result', {}).get('featureCollection', {})


def parcel_bounds(pnus, geometries):
    points = [p for pnu in pnus for f in geometries.get(pnu, {}).get('features', [])
              for p in coordinates(f.get('geometry', {}).get('coordinates', []))]
    if not points:
        return None
    return [[min(p[1] for p in points), min(p[0] for p in points)],
            [max(p[1] for p in points), max(p[0] for p in points)]]


def geometry_area(geometry):
    def ring_area(ring):
        return abs(sum(p[0] * ring[(i+1) % len(ring)][1] - ring[(i+1) % len(ring)][0] * p[1]
                       for i, p in enumerate(ring)) / 2) if ring else 0
    polygons = geometry['coordinates'] if geometry['type'] == 'MultiPolygon' else [geometry['coordinates']]
    return sum(max(0, ring_area(poly[0]) - sum(ring_area(r) for r in poly[1:])) for poly in polygons if poly)


def parcel_centers(database, wanted):
    if not database or not Path(database).exists():
        return {}, {}
    result, geometries = {}, {}
    with sqlite3.connect(Path(database).resolve().as_uri() + '?mode=ro', uri=True) as conn:
        for pnu, payload in conn.execute("SELECT cache_key,payload_json FROM vworld_response_cache WHERE cache_type='parcel'"):
            if pnu not in wanted:
                continue
            fc = collection(json.loads(payload))
            points = [p for f in fc.get('features', []) for p in coordinates(f.get('geometry', {}).get('coordinates', []))]
            if points:
                lon = (min(p[0] for p in points) + max(p[0] for p in points)) / 2
                lat = (min(p[1] for p in points) + max(p[1] for p in points)) / 2
                if 33 < lat < 39.5 and 124 < lon < 132:
                    result[pnu] = {'coord': [round(lat, 6), round(lon, 6)],
                                   'area': sum(geometry_area(f['geometry']) for f in fc['features'] if f.get('geometry'))}
                    geometries[pnu] = {'type': 'FeatureCollection', 'features': [
                        {'type': 'Feature', 'properties': {}, 'geometry': f['geometry']}
                        for f in fc['features'] if f.get('geometry')]}
    return result, geometries


def address(row):
    return ' '.join(str(s).strip() for s in [
        ['경기도', '서울특별시', '인천광역시'][row['r']], row['g'], row.get('d'), row.get('j')
    ] if s)


def build(site, database=None, coordinate_cache=None, admin_source=None):
    data = site / 'data'
    index = read(data / 'index.json')
    parcels = read(data / 'parcels.json')
    if parcels['meta']['indexRows'] != len(index['d']):
        raise ValueError('Map build: parcel/index version mismatch')
    status = read(data / 'building-status.json')
    relations = read(data / 'redevelopment-relations.json')
    partial = {r['siteKey'] for rel in relations.get('relations', []) for r in rel.get('predecessors', [])
               if r.get('scope', 'unknown') in ('partial', 'unknown')}
    sources = {f'data/{name}': sha(data / name) for name in (
        'index.json', 'parcels.json', 'building-status.json', 'redevelopment-relations.json')}
    grouped = defaultdict(list)
    for row in index['d']:
        if not row.get('as'):
            raise ValueError(f"Missing aptSeq: {row['i']}")
        grouped[row['as']].append(row)
    wanted = {p for entry in parcels['d'].values() for p in entry.get('p', [])}
    centers, geometries = parcel_centers(database, wanted)
    verified = read(coordinate_cache) if coordinate_cache and Path(coordinate_cache).exists() else {}
    output, unresolved = [], []
    by_gu = defaultdict(list)
    for key, rows in grouped.items():
        by_gu[rows[0]['g']].append((key, rows))
    for gu, groups in sorted(by_gu.items()):
        parcel_keys = {p for _, rows in groups for r in rows for p in parcels['d'].get(str(r['i']), {}).get('p', [])}
        shard = {p: geometries[p] for p in sorted(parcel_keys) if p in geometries}
        shard_path = data / 'map/parcels' / (gu + '.json')
        shard_path.parent.mkdir(parents=True, exist_ok=True)
        shard_path.write_text(json.dumps(shard, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
        sources[f'data/map/parcels/{gu}.json'] = sha(shard_path)
        tx_path = data / 'tx' / (gu + '.json')
        monthly_path = data / 'monthly' / (gu + '.json')
        tx = read(tx_path)['entries']
        sources[f'data/tx/{gu}.json'] = sha(tx_path)
        sources[f'data/monthly/{gu}.json'] = sha(monthly_path)
        for key, rows in groups:
            rows = sorted(rows, key=lambda x: (x['a'], x['i']))
            rep = rows[0]
            site_key = str(rep['r']) + '|' + '|'.join(str(rep.get(k) or '') for k in ('g', 'd', 'j'))
            lifecycle = status.get('sites', {}).get(site_key, {}).get('status', 'demolished' if rep.get('bs') == '멸실' else 'active')
            if lifecycle in ('demolished', 'rebuilding', 'rebuilt') and site_key not in partial:
                continue
            entries = [parcels['d'].get(str(r['i']), {}) for r in rows]
            pnus = sorted({p for e in entries for p in e.get('p', [])})
            available = [centers[p] for p in pnus if p in centers]
            coord, coord_source = None, None
            if available:
                # Prefer the main land parcel over tiny detached subsidiary parcels.
                coord, coord_source = max(available, key=lambda p: p['area'])['coord'], 'parcel'
            exact_address = address(rep)
            fallback = verified.get(exact_address)
            if not coord and fallback and fallback.get('address') == exact_address:
                candidate = fallback.get('coord', [])
                if len(candidate) == 2 and 33 < candidate[0] < 39.5 and 124 < candidate[1] < 132:
                    coord, coord_source = candidate, 'address'
            if not coord:
                unresolved.append({'aptSeq': key, 'address': exact_address, 'hasLot': bool(rep.get('j'))})
            areas = [{'i': r['i'], 'a': r['a'], 'u': r.get('u'), 'latest': latest(tx.get(str(r['i']), {}))} for r in rows]
            output.append({'id': key, 'n': rep['n'], 'r': rep['r'], 'g': gu, 'd': rep.get('d', ''),
                           'j': rep.get('j', ''), 'rd': rep.get('rd', ''), 'b': rep.get('b'),
                           'tu': max((r.get('tu') or 0 for r in rows), default=0) or None,
                           'coord': coord, 'coordSource': coord_source, 'pnus': pnus,
                           'parcelBounds': parcel_bounds(pnus, geometries),
                           'scope': 'approved' if entries and all(e.get('scope') == 'approved' for e in entries) else entries[0].get('scope', 'representative'),
                           'areas': areas, 'status': lifecycle})
    publication_path = data / 'housing-v3/index.json'
    if publication_path.exists():
        from map_complex_groups import merge_complexes
        sources['data/housing-v3/index.json'] = sha(publication_path)
        output = merge_complexes(output, read(publication_path), centers, geometries, parcel_bounds)
    admin = None
    if admin_source:
        from map_admin_data import build_admin
        admin, hashes, _ = build_admin(site, output, admin_source)
        sources.update(hashes)
    version = hashlib.sha256(json.dumps(sources, sort_keys=True).encode()).hexdigest()[:16]
    payload = {'meta': {'version': 1, 'sourceVersion': version, 'updated': index['meta']['updated'],
                        'indexRows': len(index['d']), 'sources': sources, 'complexes': len(output),
                        'located': sum(bool(c['coord']) for c in output)}, 'd': output}
    if admin:
        payload['admin'] = admin
    target = data / 'map/index.json'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    return payload, unresolved


def validate(site):
    payload = read(site / 'data/map/index.json')
    for name, expected in payload['meta']['sources'].items():
        if sha(site / name) != expected:
            raise ValueError(f'Map source changed: {name}')
    ids = [c['id'] for c in payload['d']]
    if len(ids) != len(set(ids)):
        raise ValueError('Duplicate map aptSeq')
    shards = {}
    source_ids = set()
    index_rows = {r['i']: r for r in read(site / 'data/index.json')['d']}
    for c in payload['d']:
        members = c.get('memberSources', [{'id': c['id']}])
        for member in members:
            if member['id'] in source_ids:
                raise ValueError('Duplicate grouped transaction source')
            source_ids.add(member['id'])
        for area in c['areas']:
            for row in area.get('rows', [{'i': area['i'], 'id': c['id']} ]):
                original = index_rows[row['i']]
                if original['as'] != row['id'] or original['a'] != area['a']:
                    raise ValueError('Grouped map area changed source identity')
        if c['g'] not in shards:
            shards[c['g']] = read(site / 'data/map/parcels' / (c['g'] + '.json'))
        if c.get('parcelBounds') != parcel_bounds(c['pnus'], shards[c['g']]):
            raise ValueError(f"Map parcel bounds mismatch: {c['id']}")
    grouped = [c for c in payload['d'] if c.get('memberSources')]
    if grouped:
        publication = read(site / 'data/housing-v3/index.json')
        approved = {g['id']: g for g in publication['complexes'] if g.get('housingFamily') == 'apartment'
                    and g.get('publicationMode') == 'trade' and g.get('kaptCodes')}
        if publication['meta'].get('approvedOnly') is not True:
            raise ValueError('Unapproved map group source')
        for c in grouped:
            group = approved.get(c['publicationId'])
            if not group or set(group['transactionKeys']) & source_ids != {m['id'] for m in c['memberSources']}:
                raise ValueError('Map group differs from approved publication')
    if payload.get('admin'):
        from map_admin_data import validate_admin
        validate_admin(payload)
    return {k: payload['meta'][k] for k in ('complexes', 'located', 'sourceVersion')}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--site', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--database', type=Path)
    parser.add_argument('--coordinate-cache', type=Path)
    parser.add_argument('--admin-source', type=Path)
    parser.add_argument('--unresolved', type=Path)
    parser.add_argument('--verify', action='store_true')
    args = parser.parse_args()
    if not args.verify:
        _, unresolved = build(args.site, args.database, args.coordinate_cache, args.admin_source)
        if args.unresolved:
            args.unresolved.write_text(json.dumps(unresolved, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(validate(args.site), ensure_ascii=False))
