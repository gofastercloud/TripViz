"""Tests for ML capabilities endpoint (non-destructive, no model downloads)."""


class TestMLCapabilities:
    def test_capabilities_returns(self, client):
        resp = client.get("/api/ml/capabilities")
        assert resp.status_code == 200
        data = resp.json()
        assert "platform" in data
        assert "torch_available" in data
        assert "mediapipe_available" in data
        assert "face_detection_ready" in data
        assert "activity_detection_ready" in data
        assert "recommended_device" in data

    def test_models_status(self, client):
        resp = client.get("/api/ml/models/status")
        assert resp.status_code == 200
        data = resp.json()
        assert "face_models" in data

    def test_batch_status_idle(self, client):
        resp = client.get("/api/ml/analyze/batch/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["running"] is False

    def test_people_empty(self, client):
        resp = client.get("/api/ml/people")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_faces_for_nonexistent_photo(self, client):
        resp = client.get("/api/ml/photos/99999/faces")
        assert resp.status_code == 200
        assert resp.json() == []
