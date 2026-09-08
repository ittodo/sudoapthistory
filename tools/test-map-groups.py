import unittest
from map_complex_groups import merge_complexes


class GroupTests(unittest.TestCase):
    def setUp(self):
        self.a = dict(id='A', n='극동', r=0, g='수지구', b=2000, rd='', tu=424,
                      pnus=['one'], coord=None, coordSource=None, scope='representative',
                      areas=[dict(i=1, a=85, latest=[20260801, 90000, 10, 0, 1]),
                             dict(i=2, a=102, latest=[20260805, 135000, 15, 0, 1])])
        self.b = dict(self.a, id='B', n='임광', pnus=['one','two'],
                      areas=[dict(i=3, a=85, latest=[20260801, 91000, 11, 1, 1]),
                             dict(i=4, a=102, latest=[20260715, 130000, 16, 0, 1])])
        self.group = dict(id='pub_group', housingFamily='apartment', publicationMode='trade',
                          kaptCodes=['K1'], transactionKeys=['A','B'], name='극동임광', units=424)

    def merge(self, groups=None):
        return merge_complexes([self.a,self.b], {'meta':{'approvedOnly':True},'complexes':groups if groups is not None else [self.group]}, {}, {}, lambda *args: None)

    def test_group_preserves_sources_and_uses_latest_trade(self):
        result = self.merge()
        self.assertEqual(len(result), 1)
        c = result[0]
        self.assertEqual((c['id'],c['n'],c['tu']), ('A','극동임광',424))
        self.assertEqual(c['pnus'], ['one','two'])
        self.assertEqual([a['a'] for a in c['areas']], [85,102])
        self.assertEqual(c['areas'][0]['latest'], [20260801,90000,10,0,2])
        self.assertEqual(c['areas'][1]['latest'][1], 135000)
        self.assertEqual(c['areas'][1]['sourceId'], 'A')
        self.assertEqual([r['i'] for a in c['areas'] for r in a['rows']], [1,3,2,4])
        self.assertEqual([m['id'] for m in c['memberSources']], ['A','B'])
        self.assertNotIn('memberSources', self.a, 'input identities are never mutated')

    def test_shared_address_or_parcel_is_not_evidence(self):
        self.assertEqual(self.merge([]), [self.a,self.b])
        self.assertEqual(self.merge([dict(self.group,kaptCodes=[])]), [self.a,self.b])
        self.assertEqual(self.merge([dict(self.group,publicationMode='metadata_only')]), [self.a,self.b])

    def test_ambiguous_group_or_unapproved_snapshot_fails(self):
        with self.assertRaisesRegex(ValueError, 'Overlapping'):
            self.merge([self.group,dict(self.group,id='another')])
        with self.assertRaisesRegex(ValueError, 'approved'):
            merge_complexes([self.a], {'meta':{},'complexes':[]}, {}, {}, None)


if __name__ == '__main__':
    unittest.main()
