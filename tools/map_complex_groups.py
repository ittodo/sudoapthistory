"""Map presentation groups from the published, approved K-APT linkage snapshot."""
from collections import defaultdict


def merge_complexes(complexes, publication, centers, geometries, bounds):
    if publication.get('meta', {}).get('approvedOnly') is not True:
        raise ValueError('Map grouping requires an approved publication snapshot')
    by_id = {c['id']: c for c in complexes}
    claimed, replacements = set(), {}
    for group in publication['complexes']:
        if group.get('housingFamily') != 'apartment' or group.get('publicationMode') != 'trade' or not group.get('kaptCodes'):
            continue
        ids = sorted(set(group.get('transactionKeys', [])) & by_id.keys())
        if len(ids) < 2:
            continue
        if claimed.intersection(ids):
            raise ValueError(f"Overlapping approved map groups: {group['id']}")
        members = [by_id[key] for key in ids]
        if len({(c['r'], c['g']) for c in members}) != 1:
            raise ValueError(f"Cross-district map group requires review: {group['id']}")
        claimed.update(ids)
        merged = dict(members[0])
        merged.update(n=group['name'], publicationId=group['id'], kaptCodes=group['kaptCodes'],
                      memberSources=[{'id': c['id'], 'n': c['n']} for c in members],
                      tu=group.get('units') or None, rd=group.get('roadAddress') or merged['rd'])
        years = sorted({c['b'] for c in members if c.get('b')})
        merged['buildYears'] = years
        merged['b'] = years[0] if years else None
        # Published site parcel membership remains authoritative; do not invent or drop members.
        merged['pnus'] = sorted({p for c in members for p in c['pnus']})
        merged['parcelBounds'] = bounds(merged['pnus'], geometries)
        located = [centers[p] for p in merged['pnus'] if p in centers]
        if located:
            merged['coord'], merged['coordSource'] = max(located, key=lambda p: p['area'])['coord'], 'parcel'
        else:
            known = next((c for c in members if c['coord']), None)
            merged['coord'] = known['coord'] if known else None
            merged['coordSource'] = known['coordSource'] if known else None
        scopes = {c['scope'] for c in members}
        merged['scope'] = 'representative_group' if any(s.startswith('representative') for s in scopes) else 'published_group'
        areas = defaultdict(list)
        for c in members:
            for a in c['areas']:
                areas[a['a']].append((c, a))
        merged['areas'] = []
        for size, rows in sorted(areas.items()):
            rows.sort(key=lambda pair: pair[1]['i'])
            priced = sorted((pair for pair in rows if pair[1]['latest']), key=lambda pair: (-pair[1]['latest'][0], pair[1]['i']))
            source, chosen = priced[0] if priced else rows[0]
            latest = list(chosen['latest']) if chosen['latest'] else None
            if latest:
                latest[4] = sum(a['latest'][4] for _, a in priced if a['latest'][0] == latest[0])
            merged['areas'].append({'i': rows[0][1]['i'], 'a': size, 'u': None, 'latest': latest,
                                    'sourceId': source['id'], 'sourceName': source['n'],
                                    'rows': [{'i': a['i'], 'g': c['g'], 'id': c['id'], 'n': c['n']} for c, a in rows]})
        replacements[ids[0]] = merged
    return [replacements.get(c['id'], c) for c in complexes if c['id'] not in claimed or c['id'] in replacements]
