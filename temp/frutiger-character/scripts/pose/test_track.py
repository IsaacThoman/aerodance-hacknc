import unittest
import numpy as np
from track import assign, clean, build_samples


def pose(x, size=.2):
    p = np.ones((33,4))
    p[:,0], p[:,1], p[:,2] = x, .5, 0
    p[[11,12],1] -= size / 2
    p[[23,24],1] += size / 2
    return p


class TrackingTests(unittest.TestCase):
    def test_initialization_ignores_small_background_people(self):
        result = assign([pose(.8,.06), pose(.65), pose(.35)], None, 1.5)
        self.assertEqual([p[0,0] for p in result], [.35,.65])

    def test_detector_order_changes_do_not_swap_identities(self):
        result = assign([pose(.64), pose(.36), pose(.34,.05)], [pose(.35),pose(.65)], 1.5)
        self.assertEqual([p[0,0] for p in result], [.36,.64])

    def test_missing_person_does_not_steal_background_pose(self):
        result = assign([pose(.36),pose(.65,.06)], [pose(.35),pose(.65)], 1.5)
        self.assertIsNotNone(result[0])
        self.assertIsNone(result[1])

    def test_short_gap_is_interpolated_and_stays_finite(self):
        raw = np.array([[pose(.3+i*.01),pose(.6)] for i in range(7)])
        raw[3,0] = np.nan
        result = clean(raw,np.arange(7)/30,.5,1)
        self.assertTrue(np.isfinite(result).all())
        self.assertAlmostEqual(result[3,0,0,0], .33)
        self.assertEqual(result[3,0,0,3], 0)


    def test_object_export_preserves_scores_gaps_and_review_evidence(self):
        raw = np.array([[pose(.3+i*.01),pose(.6)] for i in range(7)])
        # xyz, combined threshold score, separate visibility and presence.
        raw = np.concatenate([raw, np.full((*raw.shape[:3],1), .9),
            np.full((*raw.shape[:3],1), .8)], axis=3)
        raw[:,:,:,3] = .8
        raw[3,0] = np.nan
        raw[2,1,15,3:] = [.2,.3,.2]
        times = np.arange(7)/30
        samples = build_samples(raw, clean(raw,times,.5,1), times, .5)
        self.assertEqual(samples[3]['poses'][0]['playerId'], 1)
        self.assertEqual(len(samples[3]['poses']), 1)
        self.assertAlmostEqual(samples[2]['takeTimeMs'], 66.666667)
        joint = samples[2]['poses'][1]['landmarks'][15]
        self.assertEqual(set(joint), {'x','y','z','visibility','presence'})
        self.assertEqual((joint['visibility'],joint['presence']), (.3,.2))
        self.assertEqual(samples[2]['quality'][1]['landmarkOrigins'][15], 'gap-repaired')
        self.assertFalse(any(samples[2]['quality'][1]['scoreEligible']))
        self.assertEqual(len(samples[0]['poses'][0]['landmarks']), 33)


if __name__ == '__main__':
    unittest.main()
