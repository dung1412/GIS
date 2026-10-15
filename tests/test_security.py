"""Hosted-mode regression tests using a fresh SQLite DB and loopback HTTP.

Run: python -m unittest discover -s tests -v
No uploaded databases, credentials, or cloud APIs are used.
"""

import importlib.util
import io
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import sqlite3
import sys
import tempfile
import threading
import time
import types
import unittest
from unittest.mock import Mock, patch
import urllib.error
import urllib.request

import uvicorn


class HostedSecurityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="webgis-security-")
        cls.root = Path(cls.temp.name)
        backend = cls.root / "backend"
        backend.mkdir()
        source_root = Path(__file__).resolve().parents[1]
        for name in ("app.py", "auth_manager.py", "user_map_manager.py", "admin_cli.py"):
            shutil.copyfile(source_root / "backend" / name, backend / name)
        for folder in ("frontend/css", "frontend/js", "frontend/assets", "frontend/data", "data/fonts/Open Sans Regular"):
            (cls.root / folder).mkdir(parents=True, exist_ok=True)
        (cls.root / "frontend/index.html").write_text("<html>GIS</html>")
        (cls.root / "frontend/css/app.css").write_text("body {}")
        (cls.root / "frontend/data/private.geojson").write_text("private")
        (cls.root / "data/private.geojson").write_text("private")
        (cls.root / "data/provinces_boundaries.geojson").write_text('{"type":"FeatureCollection","features":[]}')
        (cls.root / "frontend/data/quangngai_districts_bbox.json").write_text("{}")
        (cls.root / "data/fonts/Open Sans Regular/0-255.pbf").write_bytes(b"glyph")
        cls.env = patch.dict(os.environ, {
            "WEBGIS_REQUIRE_AUTH": "1", "WEBGIS_ENABLE_DEMO_ACCOUNTS": "1",
            "ENVIRONMENT": "production",
        })
        cls.env.start()
        # Test the hosted default (closed public registration), regardless of
        # developer-shell configuration.
        cls.saved_registration = os.environ.pop("WEBGIS_ALLOW_REGISTRATION", None)
        cls.original_path = sys.path[:]
        cls.original_modules = {}

        def install_module(name, attributes=None):
            cls.original_modules[name] = sys.modules.get(name)
            module = types.ModuleType(name)
            for key, value in (attributes or {}).items():
                setattr(module, key, value)
            sys.modules[name] = module
            return module

        cls.layer_manager = types.SimpleNamespace(
            get_catalog=lambda: [], delete_layer=Mock(),
        )
        stubs = {
            "gis_engine": {"gis_db": types.SimpleNamespace(reload_layers=Mock(), get_provinces_summary=lambda: []), "PROVINCE_CRS_INFO": {}},
            "shape_matcher": {"shape_matcher_engine": object()},
            "redbook_vision_parser": {"document_parser": object()},
            "redbook_ocr": {"redbook_helper": object(), "vn2000_to_wgs84": lambda *args: (0, 0)},
            "eudr_compliance": {"eudr_engine": object()},
            "shp_importer": {"shp_importer": object()},
            "copernicus_engine": {"copernicus_engine": types.SimpleNamespace(username="", password="")},
            "layer_manager": {"layer_manager": cls.layer_manager},
            "raster_exporter": {"raster_exporter": object()},
            "redbook_manager": {"redbook_manager": object()},
            "mbtiles_manager": {"mbtiles_manager": object()},
            "document_font_converter": {"convert_docx": lambda value: value, "convert_xlsx": lambda value: value},
            "config": {"cloud_config": types.SimpleNamespace(GOOGLE_MAPS_API_KEY="fixture-secret-never-return")},
        }
        for name, attributes in stubs.items():
            install_module(name, attributes)

        def load_source(name, filename):
            cls.original_modules[name] = sys.modules.get(name)
            spec = importlib.util.spec_from_file_location(name, backend / filename)
            module = importlib.util.module_from_spec(spec)
            sys.modules[name] = module
            spec.loader.exec_module(module)
            return module

        cls.auth_module = load_source("auth_manager", "auth_manager.py")
        load_source("user_map_manager", "user_map_manager.py")
        cls.admin_cli = load_source("_webgis_security_backend.admin_cli", "admin_cli.py")
        install_module("_webgis_security_backend")
        install_module("_webgis_security_backend.auth_manager", {"auth_manager": cls.auth_module.auth_manager})
        cls.app_module = load_source("_webgis_security_app", "app.py")
        cls.auth = cls.auth_module.auth_manager
        cls.tokens = {}
        for role in ("admin", "member"):
            password = secrets.token_urlsafe(24)
            cls.auth.register_user(role + "test", role + "@example.invalid", password, role, role=role)
            _, cls.tokens[role], _ = cls.auth.login_user(role + "test", password)

        cls.sock = socket.socket()
        cls.sock.bind(("127.0.0.1", 0))
        cls.base_url = "http://127.0.0.1:" + str(cls.sock.getsockname()[1])
        cls.server = uvicorn.Server(uvicorn.Config(cls.app_module.app, log_level="error", lifespan="off"))
        cls.thread = threading.Thread(target=cls.server.run, kwargs={"sockets": [cls.sock]}, daemon=True)
        cls.thread.start()
        deadline = time.monotonic() + 10
        while not cls.server.started and time.monotonic() < deadline:
            time.sleep(0.02)
        if not cls.server.started:
            raise RuntimeError("Isolated test server did not start")

    @classmethod
    def tearDownClass(cls):
        cls.server.should_exit = True
        cls.thread.join(timeout=10)
        cls.sock.close()
        for name, original in cls.original_modules.items():
            if original is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = original
        sys.path[:] = cls.original_path
        cls.env.stop()
        cls.temp.cleanup()

    def request(self, path, method="GET", body=None, role=None):
        headers = {}
        if role:
            headers["Authorization"] = "Bearer " + self.tokens[role]
        if body is not None:
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(
            self.base_url + path, method=method, headers=headers,
            data=json.dumps(body).encode() if body is not None else None,
        )
        try:
            response = urllib.request.urlopen(request, timeout=5)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            content = response.read()
            return response.status, content

    def test_no_default_or_opted_in_production_demo_users(self):
        self.assertIsNone(self.auth.get_user_by_username("admin"))
        self.assertIsNone(self.auth.get_user_by_username("canbokhaosat"))
        with patch.dict(os.environ, {"WEBGIS_ENABLE_DEMO_ACCOUNTS": "0", "WEBGIS_REQUIRE_AUTH": "0", "ENVIRONMENT": "local"}):
            fresh_db = self.root / "fresh-local.db"
            manager = self.auth_module.AuthManager(str(fresh_db))
            self.assertIsNone(manager.get_user_by_username("admin"))
            with sqlite3.connect(fresh_db) as connection:
                self.assertEqual(connection.execute("SELECT count(*) FROM users").fetchone()[0], 0)

    def test_auth_required_for_source_data_and_shared_writes(self):
        self.assertEqual(self.request("/api/layers")[0], 401)
        self.assertEqual(self.request("/api/tiles/mbtiles/source/0/0/0")[0], 401)
        self.assertEqual(self.request("/api/layers/test-layer", "DELETE")[0], 401)
        self.assertEqual(self.request("/api/layers", role="member")[0], 200)

    def test_shared_writes_require_admin(self):
        self.layer_manager.delete_layer.reset_mock()
        self.assertEqual(self.request("/api/layers/test-layer", "DELETE", role="member")[0], 403)
        self.layer_manager.delete_layer.assert_not_called()
        self.assertEqual(self.request("/api/layers/test-layer", "DELETE", role="admin")[0], 200)
        self.layer_manager.delete_layer.assert_called_once_with("test-layer")

    def test_members_can_manage_only_their_own_workspace(self):
        status, content = self.request("/api/user/maps", "POST", {"name": "Member map"}, role="member")
        self.assertEqual(status, 200)
        map_id = json.loads(content)["map"]["id"]
        self.assertEqual(self.request("/api/user/maps/" + map_id, role="member")[0], 200)
        self.assertEqual(self.request("/api/user/maps/" + map_id, role="admin")[0], 404)
        self.assertEqual(self.request("/api/user/maps/" + map_id, "DELETE", role="admin")[0], 404)
        self.assertEqual(self.request("/api/user/maps/" + map_id, "DELETE", role="member")[0], 200)

    def test_registration_closed_by_default_in_hosted_mode(self):
        self.assertEqual(self.request("/api/auth/register", "POST", {
            "username": "uninvited", "email": "new@example.invalid",
            "password": secrets.token_urlsafe(24), "full_name": "New user",
        })[0], 403)

    def test_public_assets_work_but_databases_and_private_data_do_not(self):
        for path in ("/", "/css/app.css", "/static/css/app.css", "/data/provinces_boundaries.geojson", "/data/quangngai_districts_bbox.json", "/data/fonts/Open%20Sans%20Regular/0-255.pbf"):
            with self.subTest(path=path):
                self.assertEqual(self.request(path)[0], 200)
        for path in ("/data/webgis.db", "/data/private.geojson", "/data/user_layers/private.geojson", "/static/data/private.geojson", "/static/data/webgis.db", "/static/../data/webgis.db"):
            with self.subTest(path=path):
                self.assertEqual(self.request(path)[0], 404)

    def test_admin_cli_rejects_short_password_without_creating_user(self):
        output = io.StringIO()
        with patch("builtins.input", side_effect=["shortcli", "cli@example.invalid", "CLI user"]), patch(
            "getpass.getpass", side_effect=["too-short", "too-short"]
        ), patch("sys.stderr", output), patch.dict(os.environ):
            self.assertEqual(self.admin_cli.main(), 1)
        self.assertIsNone(self.auth.get_user_by_username("shortcli"))
        self.assertNotIn("too-short", output.getvalue())

    def test_admin_cli_creates_real_admin_without_printing_password(self):
        password = secrets.token_urlsafe(24)
        output = io.StringIO()
        with patch("builtins.input", side_effect=["realcli", "cli@example.invalid", "CLI user"]), patch(
            "getpass.getpass", side_effect=[password, password]
        ), patch("sys.stdout", output), patch.dict(os.environ):
            self.assertEqual(self.admin_cli.main(), 0)
        self.assertEqual(self.auth.get_user_by_username("realcli")["role"], "admin")
        self.assertNotIn(password, output.getvalue())

    def test_public_config_and_copernicus_status_contain_no_credentials(self):
        status, content = self.request("/api/config")
        self.assertEqual(status, 200)
        config = json.loads(content)
        self.assertEqual(config, {"has_google_maps_key": True, "requires_auth": True, "registration_enabled": False})
        self.assertNotIn(b"fixture-secret", content)
        status, content = self.request("/api/copernicus/status", role="member")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(content), {"status": "disconnected", "configured": False, "has_active_token": False})


if __name__ == "__main__":
    unittest.main()
