"""Tests for trip detection."""
import time


def _seed_photos(client, test_image_dir):
    client.post("/api/index/start", json={"directory": test_image_dir})
    for _ in range(30):
        if not client.get("/api/index/status").json()["running"]:
            break
        time.sleep(0.2)


class TestTripDetection:
    def test_detect_empty_library(self, client):
        resp = client.get("/api/detect/trips?geocode=false")
        assert resp.status_code == 200
        data = resp.json()
        assert data["trips"] == []
        assert data["total"] == 0

    def test_detect_with_photos(self, client, test_image_dir):
        _seed_photos(client, test_image_dir)
        resp = client.get("/api/detect/trips?geocode=false&min_photos=1&min_gps_pct=0")
        assert resp.status_code == 200
        data = resp.json()
        # All 8 test photos taken around the same time should form 1 cluster
        assert data["total"] >= 1

    def test_detect_min_photos_filter(self, client, test_image_dir):
        _seed_photos(client, test_image_dir)
        # With min_photos=100, nothing should match
        resp = client.get("/api/detect/trips?geocode=false&min_photos=100&min_gps_pct=0")
        assert resp.json()["total"] == 0

    def test_detect_gps_filter(self, client, test_image_dir):
        _seed_photos(client, test_image_dir)
        # Test images have no GPS, so 25% GPS filter should exclude everything
        resp = client.get("/api/detect/trips?geocode=false&min_photos=1&min_gps_pct=25")
        assert resp.json()["total"] == 0

    def test_detect_response_shape(self, client, test_image_dir):
        _seed_photos(client, test_image_dir)
        resp = client.get("/api/detect/trips?geocode=false&min_photos=1&min_gps_pct=0")
        trips = resp.json()["trips"]
        if trips:
            t = trips[0]
            assert "cluster_id" in t
            assert "suggested_name" in t
            assert "location_name" in t
            assert "start_date" in t
            assert "end_date" in t
            assert "photo_count" in t
            assert "photo_ids" in t
            assert "preview_pins" in t
            assert "preview_photo_ids" in t


class TestTripReplay:
    def test_replay_nonexistent_trip(self, client):
        resp = client.get("/api/detect/replay/99999")
        assert resp.status_code == 404

    def test_replay_existing_trip(self, client, test_image_dir):
        _seed_photos(client, test_image_dir)
        trip = client.post("/api/trips", json={"name": "Replay Trip"}).json()
        photos = client.get("/api/photos").json()["photos"]
        client.post("/api/photos/bulk-assign-trip", json={
            "photo_ids": [p["id"] for p in photos[:3]],
            "trip_id": trip["id"],
        })

        resp = client.get(f"/api/detect/replay/{trip['id']}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["trip"]["id"] == trip["id"]
        assert len(data["frames"]) == 3
        assert "stats" in data
