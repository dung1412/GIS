"""
MBTiles Manager for Forestry Web GIS.
Handles offline SQLite MBTiles datasets (.mbtiles) for raster and vector tiles.
Provides metadata extraction, tile serving with TMS coordinate flipping,
and layer registration.
"""

import os
import sqlite3
import json
import uuid
import datetime
from typing import Dict, Any, Optional, Tuple

import threading

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
MBTILES_DIR = os.path.join(DATA_DIR, "mbtiles")
os.makedirs(MBTILES_DIR, exist_ok=True)

class MBTilesManager:
    def __init__(self):
        self._local = threading.local()

    def _get_connection(self, mbtiles_path: str) -> sqlite3.Connection:
        """Maintains thread-local cached read-only SQLite connection per file for ultra-fast thread-safe queries (<0.5ms)."""
        if not hasattr(self._local, "connections"):
            self._local.connections = {}
        if mbtiles_path not in self._local.connections:
            uri = f"file:{os.path.abspath(mbtiles_path)}?mode=ro"
            self._local.connections[mbtiles_path] = sqlite3.connect(uri, uri=True)
        return self._local.connections[mbtiles_path]

    def register_mbtiles(self, file_bytes: bytes, filename: str, default_province: str = "Quảng Ngãi",
                         layer_name: str = "", source_type: str = "MBTiles Ngoại tuyến") -> Tuple[bool, str, Dict[str, Any]]:
        """
        Saves uploaded .mbtiles file to data/mbtiles/, inspects SQLite metadata,
        and returns layer metadata for catalog registration.
        """
        layer_id = f"mbtiles_{uuid.uuid4().hex[:8]}"
        mbtiles_filename = f"{layer_id}.mbtiles"
        mbtiles_path = os.path.join(MBTILES_DIR, mbtiles_filename)

        try:
            with open(mbtiles_path, "wb") as f:
                f.write(file_bytes)

            # Inspect metadata table
            con = sqlite3.connect(mbtiles_path)
            cur = con.cursor()

            meta = {}
            try:
                cur.execute("SELECT name, value FROM metadata")
                meta = dict(cur.fetchall())
            except Exception:
                pass

            # Detect format (png, jpg, webp, pbf)
            tile_format = meta.get("format", "png").lower()
            tile_type = "vector" if tile_format in ["pbf", "mvt"] else "raster"

            # Parse bounds: min_lon, min_lat, max_lon, max_lat
            bounds_str = meta.get("bounds", "108.0,14.0,109.5,15.5")
            try:
                bounds = [float(x.strip()) for x in bounds_str.split(",")]
                if len(bounds) != 4:
                    bounds = [108.2, 14.3, 109.2, 15.3]
            except Exception:
                bounds = [108.2, 14.3, 109.2, 15.3]

            min_zoom = int(meta.get("minzoom", 0))
            max_zoom = int(meta.get("maxzoom", 18))

            # Count total tiles in SQLite
            try:
                cur.execute("SELECT COUNT(*) FROM tiles")
                total_tiles = cur.fetchone()[0]
            except Exception:
                total_tiles = 0

            con.close()

            actual_name = layer_name or meta.get("name") or os.path.splitext(filename)[0]

            layer_meta = {
                "id": layer_id,
                "name": actual_name,
                "filename": filename or mbtiles_filename,
                "province": default_province,
                "source_type": source_type,
                "format": "mbtiles",
                "tile_type": tile_type,
                "tile_format": tile_format,
                "mbtiles_file": mbtiles_filename,
                "tile_url": f"/api/tiles/mbtiles/{layer_id}/{{z}}/{{x}}/{{y}}",
                "bounds": bounds,
                "minzoom": min_zoom,
                "maxzoom": max_zoom,
                "feature_count": total_tiles,
                "total_area_ha": 0.0,
                "columns": ["zoom_level", "tile_column", "tile_row", "tile_format"],
                "created_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "visible": True,
                "opacity": 0.85
            }

            from layer_manager import layer_manager
            catalog = layer_manager.get_catalog()
            catalog.append(layer_meta)
            layer_manager._save_catalog(catalog)

            return True, f"Đã nạp thành công bản đồ MBTiles '{actual_name}' ({total_tiles} mảnh gạch tile, định dạng {tile_format.upper()})!", layer_meta

        except Exception as e:
            if os.path.exists(mbtiles_path):
                try:
                    os.remove(mbtiles_path)
                except Exception:
                    pass
            return False, f"Lỗi khi đọc file MBTiles: {str(e)}", {}

    def get_tile(self, layer_id: str, z: int, x: int, y: int) -> Tuple[Optional[bytes], str]:
        """
        Retrieves tile data from SQLite with TMS coordinate flip:
        tms_y = (2^z - 1) - y
        """
        mbtiles_path = os.path.join(MBTILES_DIR, f"{layer_id}.mbtiles")
        if not os.path.exists(mbtiles_path):
            return None, "image/png"

        try:
            con = self._get_connection(mbtiles_path)
            cur = con.cursor()

            # TMS flip
            tms_y = (2**z - 1) - y

            cur.execute("SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?", (z, x, tms_y))
            row = cur.fetchone()

            if not row or not row[0]:
                # Try direct y (some non-standard MBTiles use XYZ instead of TMS)
                cur.execute("SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?", (z, x, y))
                row = cur.fetchone()

            if row and row[0]:
                tile_data = row[0]
                # Detect media type from byte header
                if tile_data.startswith(b'\x89PNG'):
                    media_type = "image/png"
                elif tile_data.startswith(b'\xff\xd8\xff'):
                    media_type = "image/jpeg"
                elif tile_data.startswith(b'RIFF') and b'WEBP' in tile_data[:16]:
                    media_type = "image/webp"
                elif tile_data.startswith(b'\x1f\x8b'): # Gzipped protobuf MVT
                    media_type = "application/x-protobuf"
                else:
                    media_type = "image/png"

                return tile_data, media_type

        except Exception as e:
            print(f"Error fetching tile {z}/{x}/{y} from {layer_id}: {e}")

        return None, "image/png"

    def is_vector(self, layer_id: str) -> bool:
        """Determines if the MBTiles layer contains vector tiles (pbf/mvt)."""
        mbtiles_path = os.path.join(MBTILES_DIR, f"{layer_id}.mbtiles")
        if not os.path.exists(mbtiles_path):
            return False
        try:
            con = self._get_connection(mbtiles_path)
            cur = con.cursor()
            cur.execute("SELECT value FROM metadata WHERE name = 'format'")
            row = cur.fetchone()
            if row and row[0]:
                return row[0].lower() in ["pbf", "mvt"]
        except Exception:
            pass
        return False

    def delete_mbtiles(self, layer_id: str):
        """Closes connection and deletes .mbtiles file."""
        mbtiles_path = os.path.join(MBTILES_DIR, f"{layer_id}.mbtiles")
        if hasattr(self._local, "connections") and mbtiles_path in self._local.connections:
            try:
                self._local.connections[mbtiles_path].close()
            except Exception:
                pass
            self._local.connections.pop(mbtiles_path, None)

        if os.path.exists(mbtiles_path):
            try:
                os.remove(mbtiles_path)
            except Exception:
                pass

mbtiles_manager = MBTilesManager()

