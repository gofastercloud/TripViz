"""Tests for geo-clustering helper."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from routers.photos import _cluster_pins


class TestGeoClustering:
    def test_empty_input(self):
        assert _cluster_pins([], 200) == []

    def test_single_pin(self):
        pins = [{"id": 1, "lat": 51.5, "lon": -0.1, "date": "2024-01-01", "trip_id": None, "trip_color": None, "trip_name": None}]
        result = _cluster_pins(pins, 200)
        assert len(result) == 1
        assert result[0]["count"] == 1
        assert result[0]["lat"] == 51.5

    def test_nearby_pins_clustered(self):
        """Two pins ~50m apart should merge at 200m radius."""
        pins = [
            {"id": 1, "lat": 51.50000, "lon": -0.10000, "date": "2024-01-01", "trip_id": None, "trip_color": None, "trip_name": None},
            {"id": 2, "lat": 51.50040, "lon": -0.10000, "date": "2024-01-02", "trip_id": None, "trip_color": None, "trip_name": None},
        ]
        result = _cluster_pins(pins, 200)
        assert len(result) == 1
        assert result[0]["count"] == 2
        assert set(result[0]["photo_ids"]) == {1, 2}

    def test_distant_pins_separate(self):
        """Two pins ~11km apart should NOT merge at 200m radius."""
        pins = [
            {"id": 1, "lat": 51.5, "lon": -0.1, "date": "2024-01-01", "trip_id": None, "trip_color": None, "trip_name": None},
            {"id": 2, "lat": 51.6, "lon": -0.1, "date": "2024-01-02", "trip_id": None, "trip_color": None, "trip_name": None},
        ]
        result = _cluster_pins(pins, 200)
        assert len(result) == 2

    def test_weighted_average_position(self):
        """Cluster centroid should be the average of constituent positions."""
        pins = [
            {"id": 1, "lat": 10.0, "lon": 20.0, "date": None, "trip_id": None, "trip_color": None, "trip_name": None},
            {"id": 2, "lat": 10.0001, "lon": 20.0001, "date": None, "trip_id": None, "trip_color": None, "trip_name": None},
        ]
        result = _cluster_pins(pins, 200)
        assert len(result) == 1
        assert abs(result[0]["lat"] - 10.00005) < 0.001
        assert abs(result[0]["lon"] - 20.00005) < 0.001

    def test_no_clustering_at_zero_radius(self):
        pins = [
            {"id": 1, "lat": 51.5, "lon": -0.1, "date": None, "trip_id": None, "trip_color": None, "trip_name": None},
            {"id": 2, "lat": 51.5, "lon": -0.1, "date": None, "trip_id": None, "trip_color": None, "trip_name": None},
        ]
        # radius=0 means only exact same point clusters (haversine=0)
        result = _cluster_pins(pins, 0)
        assert len(result) == 1  # same exact coords

    def test_latest_date_preserved(self):
        pins = [
            {"id": 1, "lat": 51.5, "lon": -0.1, "date": "2024-01-01", "trip_id": None, "trip_color": None, "trip_name": None},
            {"id": 2, "lat": 51.50001, "lon": -0.1, "date": "2024-06-15", "trip_id": None, "trip_color": None, "trip_name": None},
        ]
        result = _cluster_pins(pins, 200)
        assert result[0]["date"] == "2024-06-15"

    def test_three_clusters(self):
        """Three locations far apart should produce three clusters."""
        pins = [
            {"id": 1, "lat": 0.0, "lon": 0.0, "date": None, "trip_id": None, "trip_color": None, "trip_name": None},
            {"id": 2, "lat": 10.0, "lon": 10.0, "date": None, "trip_id": None, "trip_color": None, "trip_name": None},
            {"id": 3, "lat": -10.0, "lon": -10.0, "date": None, "trip_id": None, "trip_color": None, "trip_name": None},
        ]
        result = _cluster_pins(pins, 200)
        assert len(result) == 3
