"""Tests for photo indexing."""
import os
import time
import tempfile


class TestIndexing:
    def test_index_valid_directory(self, client, test_image_dir):
        resp = client.post("/api/index/start", json={"directory": test_image_dir})
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

        # Wait for completion
        for _ in range(30):
            status = client.get("/api/index/status").json()
            if not status["running"]:
                break
            time.sleep(0.2)

        assert status["total"] == 8
        assert status["processed"] == 8
        assert status["errors"] == 0

    def test_index_nonexistent_directory(self, client):
        resp = client.post("/api/index/start", json={
            "directory": "/nonexistent/path/that/does/not/exist"
        })
        assert resp.status_code == 400

    def test_index_status_idle(self, client):
        resp = client.get("/api/index/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["running"] is False

    def test_recursive_indexing(self, client, test_image_dir):
        """Ensure subdirectories are scanned."""
        resp = client.post("/api/index/start", json={"directory": test_image_dir})
        assert resp.status_code == 200

        for _ in range(30):
            status = client.get("/api/index/status").json()
            if not status["running"]:
                break
            time.sleep(0.2)

        # Should find 5 in root + 3 in subdir
        assert status["total"] == 8

    def test_skip_already_indexed(self, client, test_image_dir):
        """Second run should skip all photos."""
        client.post("/api/index/start", json={"directory": test_image_dir})
        for _ in range(30):
            if not client.get("/api/index/status").json()["running"]:
                break
            time.sleep(0.2)

        # Run again without force
        client.post("/api/index/start", json={"directory": test_image_dir})
        for _ in range(30):
            status = client.get("/api/index/status").json()
            if not status["running"]:
                break
            time.sleep(0.2)

        assert status["skipped"] == 8
        assert status["processed"] == 8

    def test_force_reindex(self, client, test_image_dir):
        """Force reindex should re-process all photos."""
        client.post("/api/index/start", json={"directory": test_image_dir})
        for _ in range(30):
            if not client.get("/api/index/status").json()["running"]:
                break
            time.sleep(0.2)

        client.post("/api/index/start", json={
            "directory": test_image_dir,
            "force_reindex": True,
        })
        for _ in range(30):
            status = client.get("/api/index/status").json()
            if not status["running"]:
                break
            time.sleep(0.2)

        assert status["skipped"] == 0
        assert status["processed"] == 8

    def test_unsupported_files_ignored(self, client, tmp_path):
        """Non-image files should be ignored."""
        (tmp_path / "readme.txt").write_text("hello")
        (tmp_path / "data.csv").write_text("a,b,c")

        client.post("/api/index/start", json={"directory": str(tmp_path)})
        for _ in range(30):
            status = client.get("/api/index/status").json()
            if not status["running"]:
                break
            time.sleep(0.2)

        assert status["total"] == 0

    def test_thumbnails_generated(self, client, test_image_dir):
        """Thumbnails should be created during indexing."""
        client.post("/api/index/start", json={"directory": test_image_dir})
        for _ in range(30):
            if not client.get("/api/index/status").json()["running"]:
                break
            time.sleep(0.2)

        photos = client.get("/api/photos").json()["photos"]
        assert all(p["has_thumbnail"] for p in photos)
