"""Tests for the kit list API and lens brand inference."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from routers.kit import _classify, _infer_lens_brand, _collapse_phone_lens


class TestDeviceClassification:
    def test_iphone_is_phone(self):
        assert _classify("Apple", "iPhone 15 Pro") == "phone"

    def test_ipad_is_phone(self):
        assert _classify("Apple", "iPad Pro") == "phone"

    def test_samsung_galaxy_is_phone(self):
        assert _classify("samsung", "Galaxy S24 Ultra") == "phone"

    def test_google_pixel_is_phone(self):
        assert _classify("Google", "Pixel 8 Pro") == "phone"

    def test_canon_eos_is_camera(self):
        assert _classify("Canon", "EOS R5") == "camera"

    def test_nikon_is_camera(self):
        assert _classify("Nikon", "Z 8") == "camera"

    def test_sony_zve10_is_camera(self):
        assert _classify("SONY", "ZV-E10") == "camera"

    def test_sony_nex_is_camera(self):
        assert _classify("SONY", "NEX-5R") == "camera"

    def test_sony_alpha_is_camera(self):
        assert _classify("SONY", "ILCE-7M4") == "camera"

    def test_fujifilm_is_camera(self):
        assert _classify("FUJIFILM", "X-T5") == "camera"

    def test_gopro_is_camera(self):
        assert _classify("GoPro", "HERO12 Black") == "camera"

    def test_dji_is_camera(self):
        assert _classify("DJI", "Mavic 3 Pro") == "camera"


class TestLensBrandInference:
    def test_canon_rf(self):
        assert _infer_lens_brand("RF50mm F1.2 L USM") == "Canon"

    def test_canon_ef(self):
        assert _infer_lens_brand("EF70-200mm f/2.8L IS III USM") == "Canon"

    def test_canon_efs(self):
        assert _infer_lens_brand("EF-S18-135mm f/3.5-5.6 IS STM") == "Canon"

    def test_sony_fe(self):
        assert _infer_lens_brand("FE 24-70mm F2.8 GM II") == "Sony"

    def test_sony_e(self):
        assert _infer_lens_brand("E 35mm F1.8 OSS") == "Sony"

    def test_nikon_nikkor(self):
        assert _infer_lens_brand("NIKKOR Z 50mm f/1.8 S") == "Nikon"

    def test_nikon_z(self):
        assert _infer_lens_brand("Z 24-70mm f/4 S") == "Nikon"

    def test_sigma_contemporary(self):
        assert _infer_lens_brand("30mm F1.4 DC DN | Contemporary 016") == "Sigma"

    def test_sigma_art(self):
        assert _infer_lens_brand("35mm F1.4 DG HSM | Art") == "Sigma"

    def test_fuji_xf(self):
        assert _infer_lens_brand("XF56mmF1.2 R") == "Fujifilm"

    def test_olympus_mzuiko(self):
        assert _infer_lens_brand("M.Zuiko Digital ED 12-40mm F2.8 PRO") == "Olympus"

    def test_tamron_di(self):
        assert _infer_lens_brand("Di III RXD 17-28mm F/2.8") == "Tamron"

    def test_unknown_lens(self):
        assert _infer_lens_brand("Some Random Lens 50mm") is None


class TestPhoneLensCollapse:
    def test_iphone_back_collapsed(self):
        display, _, _ = _collapse_phone_lens("iPhone 15 Pro back triple camera 6.765mm f/1.78")
        assert display == "iPhone 15 Pro — Back Camera"

    def test_iphone_front_collapsed(self):
        display, _, _ = _collapse_phone_lens("iPhone 14 Pro front camera 2.69mm f/1.9")
        assert display == "iPhone 14 Pro — Front Camera"

    def test_ipad_collapsed(self):
        display, _, _ = _collapse_phone_lens("iPad Pro front camera 2.65mm f/2.2")
        assert display == "iPad Pro — Front Camera"

    def test_dedicated_lens_untouched(self):
        display, _, _ = _collapse_phone_lens("E 35mm F1.8 OSS")
        assert display == "E 35mm F1.8 OSS"

    def test_canon_rf_untouched(self):
        display, _, _ = _collapse_phone_lens("RF50mm F1.2 L USM")
        assert display == "RF50mm F1.2 L USM"


class TestKitEndpoint:
    def test_kit_empty(self, client):
        resp = client.get("/api/kit")
        assert resp.status_code == 200
        data = resp.json()
        assert data["cameras"] == []
        assert data["phones"] == []
        assert data["lenses"] == []
        assert data["total_devices"] == 0
