"""Tests for the photos API."""
import json


def _seed_photos(client, test_image_dir):
    """Index test images and wait for completion."""
    resp = client.post("/api/index/start", json={"directory": test_image_dir})
    assert resp.status_code == 200
    # Poll until done (test images are tiny, should be instant)
    import time
    for _ in range(30):
        status = client.get("/api/index/status").json()
        if not status["running"]:
            break
        time.sleep(0.2)
    return status


class TestPhotoListing:
    def test_empty_library(self, client):
        resp = client.get("/api/photos")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 0
        assert data["photos"] == []

    def test_list_after_indexing(self, client, test_image_dir):
        _seed_photos(client, test_image_dir)
        resp = client.get("/api/photos")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 8  # 5 in root + 3 in subdir

    def test_pagination(self, client, test_image_dir):
        _seed_photos(client, test_image_dir)
        resp = client.get("/api/photos?per_page=3&page=1")
        data = resp.json()
        assert len(data["photos"]) == 3
        assert data["pages"] == 3  # 8 photos / 3 per page = 3 pages

        resp2 = client.get("/api/photos?per_page=3&page=3")
        data2 = resp2.json()
        assert len(data2["photos"]) == 2  # last page has 2

    def test_sort_orders(self, client, test_image_dir):
        _seed_photos(client, test_image_dir)
        resp_desc = client.get("/api/photos?sort=date_desc").json()
        resp_asc = client.get("/api/photos?sort=date_asc").json()
        resp_name = client.get("/api/photos?sort=name_asc").json()
        assert resp_desc["total"] == resp_asc["total"] == resp_name["total"]


class TestPhotoDetail:
    def test_get_photo(self, client, test_image_dir):
        _seed_photos(client, test_image_dir)
        photos = client.get("/api/photos").json()["photos"]
        photo_id = photos[0]["id"]

        resp = client.get(f"/api/photos/{photo_id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == photo_id
        assert data["filename"].endswith(".jpg")

    def test_get_nonexistent_photo(self, client):
        resp = client.get("/api/photos/99999")
        assert resp.status_code == 404

    def test_photo_thumbnail(self, client, test_image_dir):
        _seed_photos(client, test_image_dir)
        photos = client.get("/api/photos").json()["photos"]
        photo_id = photos[0]["id"]

        resp = client.get(f"/api/photos/{photo_id}/thumbnail")
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "image/jpeg"

    def test_photo_image(self, client, test_image_dir):
        _seed_photos(client, test_image_dir)
        photos = client.get("/api/photos").json()["photos"]
        photo_id = photos[0]["id"]

        resp = client.get(f"/api/photos/{photo_id}/image")
        assert resp.status_code == 200

    def test_photo_exif(self, client, test_image_dir):
        _seed_photos(client, test_image_dir)
        photos = client.get("/api/photos").json()["photos"]
        photo_id = photos[0]["id"]

        resp = client.get(f"/api/photos/{photo_id}/exif")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, dict)


class TestPhotoNotes:
    def test_update_notes(self, client, test_image_dir):
        _seed_photos(client, test_image_dir)
        photos = client.get("/api/photos").json()["photos"]
        photo_id = photos[0]["id"]

        resp = client.put(f"/api/photos/{photo_id}/notes", json={"notes": "Hello world"})
        assert resp.status_code == 200
        assert resp.json()["notes"] == "Hello world"

    def test_notes_max_length(self, client, test_image_dir):
        _seed_photos(client, test_image_dir)
        photos = client.get("/api/photos").json()["photos"]
        photo_id = photos[0]["id"]

        long_note = "x" * 251
        resp = client.put(f"/api/photos/{photo_id}/notes", json={"notes": long_note})
        assert resp.status_code == 400

    def test_clear_notes(self, client, test_image_dir):
        _seed_photos(client, test_image_dir)
        photos = client.get("/api/photos").json()["photos"]
        photo_id = photos[0]["id"]

        client.put(f"/api/photos/{photo_id}/notes", json={"notes": "temp"})
        resp = client.put(f"/api/photos/{photo_id}/notes", json={"notes": None})
        assert resp.status_code == 200
        assert resp.json()["notes"] is None


class TestPhotoFilters:
    def test_filter_no_trip(self, client, test_image_dir):
        _seed_photos(client, test_image_dir)
        resp = client.get("/api/photos?no_trip=true")
        data = resp.json()
        assert data["total"] == 8  # all photos have no trip initially

    def test_filter_by_date_range(self, client, test_image_dir):
        _seed_photos(client, test_image_dir)
        # All test photos will have dates around now (file mtime)
        resp = client.get("/api/photos?date_from=2020-01-01&date_to=2099-12-31")
        assert resp.status_code == 200

    def test_filter_by_camera(self, client, test_image_dir):
        _seed_photos(client, test_image_dir)
        # Test photos have no camera info, should return 0
        resp = client.get("/api/photos?camera_make=Canon")
        assert resp.json()["total"] == 0


class TestStats:
    def test_stats_empty(self, client):
        resp = client.get("/api/photos/stats/summary")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_photos"] == 0

    def test_stats_after_indexing(self, client, test_image_dir):
        _seed_photos(client, test_image_dir)
        resp = client.get("/api/photos/stats/summary")
        data = resp.json()
        assert data["total_photos"] == 8
        assert data["geotagged"] == 0  # test images have no GPS


class TestMapPins:
    def test_map_pins_empty(self, client):
        resp = client.get("/api/photos/map-pins")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_map_pins_no_gps(self, client, test_image_dir):
        _seed_photos(client, test_image_dir)
        resp = client.get("/api/photos/map-pins")
        assert resp.json() == []  # test images have no GPS


class TestSearch:
    def test_search_by_filename(self, client, test_image_dir):
        _seed_photos(client, test_image_dir)
        resp = client.get("/api/photos/search/query?q=test_0")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] >= 1

    def test_search_no_results(self, client, test_image_dir):
        _seed_photos(client, test_image_dir)
        resp = client.get("/api/photos/search/query?q=xyznonexistent")
        assert resp.json()["total"] == 0

    def test_search_by_notes(self, client, test_image_dir):
        _seed_photos(client, test_image_dir)
        photos = client.get("/api/photos").json()["photos"]
        client.put(f"/api/photos/{photos[0]['id']}/notes", json={"notes": "sunset beach vacation"})

        resp = client.get("/api/photos/search/query?q=sunset")
        assert resp.json()["total"] == 1

    def test_suggest_empty(self, client):
        resp = client.get("/api/photos/search/suggest?q=test")
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)
