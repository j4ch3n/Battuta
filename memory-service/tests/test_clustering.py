import unittest

import numpy as np

from battuta_memory.clustering import cluster, cluster_projects
from battuta_memory.config import DIMENSION


def unit(angles):
    return np.array([[np.cos(a), np.sin(a)] for a in angles], dtype=np.float32)


def blob(angle, scale=1.0):
    vector = np.zeros(DIMENSION, dtype="<f4")
    vector[:2] = [np.cos(angle) * scale, np.sin(angle) * scale]
    return vector.tobytes()


class ClusterTests(unittest.TestCase):
    def test_components_chain_and_singletons_are_excluded(self):
        # 0-1-2 chain links through 1 (0 and 2 are below threshold); 3 is alone; 4-5 pair.
        vectors = unit([0, 0.7, 1.4, 3.0, 4.5, 4.5])
        clusters, raised = cluster(vectors, 0.7, 10)
        self.assertEqual(sorted(sorted(c) for c in clusters), [[0, 1, 2], [4, 5]])
        self.assertEqual(raised, [])

    def test_tiny_inputs_have_no_clusters(self):
        for vectors in (np.empty((0, 2), dtype=np.float32), unit([0])):
            with self.subTest(rows=len(vectors)):
                self.assertEqual(cluster(vectors, 0.5, 5), ([], []))

    def test_oversize_component_is_split_by_raising_threshold(self):
        vectors = unit([0, 0.1, 0.2, 1.5, 1.6, 1.7])
        # Within-group cosines ~0.98+, across ~0.07: only one loose chain at threshold 0.0.
        clusters, raised = cluster(vectors, 0.05, 3)
        self.assertEqual(sorted(sorted(c) for c in clusters), [[0, 1, 2], [3, 4, 5]])
        self.assertTrue(raised)
        self.assertTrue(all(step["to"] > step["from"] for step in raised))
        self.assertTrue(all(len(c) <= 3 for c in clusters))

    def test_unsplittable_component_fails(self):
        with self.assertRaisesRegex(ValueError, "split"):
            cluster(unit([0] * 4), 0.5, 3)

    def test_result_is_deterministic(self):
        vectors = unit([0, 0.1, 0.2, 1.5, 1.6, 1.7])
        self.assertEqual(cluster(vectors, 0.05, 3), cluster(vectors.copy(), 0.05, 3))


class ClusterProjectsTests(unittest.TestCase):
    def test_projects_sorted_and_shared_records_join_each_project(self):
        groups = {
            "zeta": [("z1", blob(0)), ("shared", blob(0.01))],
            "alpha": [("shared", blob(0.01)), ("a2", blob(3.0)), ("a3", blob(0, scale=5))],
        }
        report = cluster_projects(groups, 0.9, 10)
        self.assertEqual([p["project"] for p in report], ["alpha", "zeta"])
        alpha, zeta = report
        self.assertEqual(alpha["clusters"], [["shared", "a3"]])
        self.assertEqual((alpha["singletons"], alpha["largest"], alpha["raised"]), (1, 2, []))
        self.assertEqual(zeta["clusters"], [["z1", "shared"]])

    def test_clusters_are_ordered_by_first_member_and_empty_project_reports_zero(self):
        groups = {"p": [("x", blob(3.0)), ("a", blob(0)), ("y", blob(3.0)), ("b", blob(0))], "q": [("only", blob(0))]}
        report = {p["project"]: p for p in cluster_projects(groups, 0.9, 10)}
        self.assertEqual(report["p"]["clusters"], [["x", "y"], ["a", "b"]])
        self.assertEqual(report["q"], {"project": "q", "clusters": [], "singletons": 1, "largest": 0, "raised": []})
