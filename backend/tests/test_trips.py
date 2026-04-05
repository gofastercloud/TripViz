"""Tests for the trips API."""
import time


def _seed_photos(client, test_image_dir):
    client.post("/api/index/start", json={"directory": test_image_dir})
    for _ in range(30):
        if not client.get("/api/index/status").json()["running"]:
            break
        time.sleep(0.2)


class TestTripCRUD:
    def test_list_empty(self, client):
        resp = client.get("/api/trips")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_create_trip(self, client):
        resp = client.post("/api/trips", json={
            "name": "Tokyo 2024",
            "description": "Cherry blossom trip",
            "color": "#EF4444",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Tokyo 2024"
        assert data["color"] == "#EF4444"
        assert data["id"] is not None

    def test_list_trips(self, client):
        client.post("/api/trips", json={"name": "Trip A"})
        client.post("/api/trips", json={"name": "Trip B"})
        resp = client.get("/api/trips")
        assert len(resp.json()) == 2

    def test_update_trip(self, client):
        trip = client.post("/api/trips", json={"name": "Old Name"}).json()
        resp = client.put(f"/api/trips/{trip['id']}", json={"name": "New Name"})
        assert resp.status_code == 200
        assert resp.json()["name"] == "New Name"

    def test_update_nonexistent_trip(self, client):
        resp = client.put("/api/trips/99999", json={"name": "X"})
        assert resp.status_code == 404

    def test_delete_trip(self, client):
        trip = client.post("/api/trips", json={"name": "Delete Me"}).json()
        resp = client.delete(f"/api/trips/{trip['id']}")
        assert resp.status_code == 200
        assert client.get("/api/trips").json() == []

    def test_delete_nonexistent_trip(self, client):
        resp = client.delete("/api/trips/99999")
        assert resp.status_code == 404


class TestPhotoTripAssignment:
    def test_assign_photo_to_trip(self, client, test_image_dir):
        _seed_photos(client, test_image_dir)
        trip = client.post("/api/trips", json={"name": "Test Trip"}).json()
        photos = client.get("/api/photos").json()["photos"]
        photo_id = photos[0]["id"]

        resp = client.put(f"/api/photos/{photo_id}/trip", json={"trip_id": trip["id"]})
        assert resp.status_code == 200
        assert resp.json()["trip_id"] == trip["id"]
        assert resp.json()["trip_name"] == "Test Trip"

    def test_unassign_photo_from_trip(self, client, test_image_dir):
        _seed_photos(client, test_image_dir)
        trip = client.post("/api/trips", json={"name": "Test Trip"}).json()
        photos = client.get("/api/photos").json()["photos"]
        photo_id = photos[0]["id"]

        client.put(f"/api/photos/{photo_id}/trip", json={"trip_id": trip["id"]})
        resp = client.put(f"/api/photos/{photo_id}/trip", json={"trip_id": None})
        assert resp.status_code == 200
        assert resp.json()["trip_id"] is None

    def test_assign_to_nonexistent_trip(self, client, test_image_dir):
        _seed_photos(client, test_image_dir)
        photos = client.get("/api/photos").json()["photos"]
        resp = client.put(f"/api/photos/{photos[0]['id']}/trip", json={"trip_id": 99999})
        assert resp.status_code == 404

    def test_bulk_assign(self, client, test_image_dir):
        _seed_photos(client, test_image_dir)
        trip = client.post("/api/trips", json={"name": "Bulk Trip"}).json()
        photos = client.get("/api/photos").json()["photos"]
        ids = [p["id"] for p in photos[:3]]

        resp = client.post("/api/photos/bulk-assign-trip", json={
            "photo_ids": ids,
            "trip_id": trip["id"],
        })
        assert resp.status_code == 200
        assert resp.json()["updated"] == 3

        # Verify via filter
        resp = client.get(f"/api/photos?trip_id={trip['id']}")
        assert resp.json()["total"] == 3

    def test_bulk_unassign(self, client, test_image_dir):
        _seed_photos(client, test_image_dir)
        trip = client.post("/api/trips", json={"name": "Temp Trip"}).json()
        photos = client.get("/api/photos").json()["photos"]
        ids = [p["id"] for p in photos[:2]]

        client.post("/api/photos/bulk-assign-trip", json={"photo_ids": ids, "trip_id": trip["id"]})
        resp = client.post("/api/photos/bulk-assign-trip", json={"photo_ids": ids, "trip_id": None})
        assert resp.json()["updated"] == 2

    def test_filter_by_trip(self, client, test_image_dir):
        _seed_photos(client, test_image_dir)
        trip = client.post("/api/trips", json={"name": "Filter Trip"}).json()
        photos = client.get("/api/photos").json()["photos"]

        client.put(f"/api/photos/{photos[0]['id']}/trip", json={"trip_id": trip["id"]})

        with_trip = client.get(f"/api/photos?trip_id={trip['id']}").json()
        assert with_trip["total"] == 1

        no_trip = client.get("/api/photos?no_trip=true").json()
        assert no_trip["total"] == 7

    def test_trip_photo_count(self, client, test_image_dir):
        _seed_photos(client, test_image_dir)
        trip = client.post("/api/trips", json={"name": "Count Trip"}).json()
        photos = client.get("/api/photos").json()["photos"]

        client.post("/api/photos/bulk-assign-trip", json={
            "photo_ids": [p["id"] for p in photos[:4]],
            "trip_id": trip["id"],
        })

        trips = client.get("/api/trips").json()
        count_trip = next(t for t in trips if t["id"] == trip["id"])
        assert count_trip["photo_count"] == 4

    def test_delete_trip_unassigns_photos(self, client, test_image_dir):
        _seed_photos(client, test_image_dir)
        trip = client.post("/api/trips", json={"name": "Delete Trip"}).json()
        photos = client.get("/api/photos").json()["photos"]
        photo_id = photos[0]["id"]

        client.put(f"/api/photos/{photo_id}/trip", json={"trip_id": trip["id"]})
        client.delete(f"/api/trips/{trip['id']}")

        photo = client.get(f"/api/photos/{photo_id}").json()
        assert photo["trip_id"] is None
