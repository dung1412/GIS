"""
User Map Workspace & Private Layer Management Module.
Enables each authenticated member to maintain their own private maps and private GIS layers.
"""

import os
import json
import sqlite3
import secrets
import datetime
from typing import Optional, Dict, Any, List

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
DB_PATH = os.path.join(DATA_DIR, "webgis.db")
USER_LAYERS_DIR = os.path.join(DATA_DIR, "user_layers")
os.makedirs(USER_LAYERS_DIR, exist_ok=True)

class UserMapManager:
    def __init__(self, db_path: str = DB_PATH):
        self.db_path = db_path

    def _get_connection(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    # --- MAP WORKSPACES ---

    def list_user_maps(self, user_id: str) -> List[Dict[str, Any]]:
        with self._get_connection() as conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT * FROM user_maps 
                WHERE user_id = ? OR is_public = 1
                ORDER BY updated_at DESC
            """, (user_id,))
            rows = cur.fetchall()

            maps = []
            for r in rows:
                # Count private layers for this map
                cur.execute("SELECT count(*) FROM user_layers WHERE map_id = ?", (r["id"],))
                layer_count = cur.fetchone()[0]

                maps.append({
                    "id": r["id"],
                    "user_id": r["user_id"],
                    "name": r["name"],
                    "description": r["description"],
                    "province": r["province"],
                    "center_lon": r["center_lon"],
                    "center_lat": r["center_lat"],
                    "zoom_level": r["zoom_level"],
                    "basemap": r["basemap"],
                    "is_public": bool(r["is_public"]),
                    "is_owner": (r["user_id"] == user_id),
                    "layer_count": layer_count,
                    "created_at": r["created_at"],
                    "updated_at": r["updated_at"]
                })
            return maps

    def create_user_map(self, user_id: str, name: str, description: str = "",
                        province: str = "Quảng Ngãi", center_lon: float = 108.68,
                        center_lat: float = 15.02, zoom_level: float = 11.0,
                        basemap: str = "google-hybrid", is_public: bool = False) -> Dict[str, Any]:
        map_id = f"map_{secrets.token_hex(6)}"
        now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        with self._get_connection() as conn:
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO user_maps (id, user_id, name, description, province, center_lon, center_lat, zoom_level, basemap, is_public, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (map_id, user_id, name.strip(), description.strip(), province, center_lon, center_lat, zoom_level, basemap, int(is_public), now_str, now_str))
            conn.commit()

        return self.get_user_map(map_id, user_id)

    def get_user_map(self, map_id: str, user_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        with self._get_connection() as conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM user_maps WHERE id = ?", (map_id,))
            r = cur.fetchone()

        if not r:
            return None

        # Check access permission: public or owned by user
        if not r["is_public"] and user_id and r["user_id"] != user_id:
            return None

        return {
            "id": r["id"],
            "user_id": r["user_id"],
            "name": r["name"],
            "description": r["description"],
            "province": r["province"],
            "center_lon": r["center_lon"],
            "center_lat": r["center_lat"],
            "zoom_level": r["zoom_level"],
            "basemap": r["basemap"],
            "is_public": bool(r["is_public"]),
            "is_owner": bool(user_id and r["user_id"] == user_id),
            "created_at": r["created_at"],
            "updated_at": r["updated_at"]
        }

    def update_user_map(self, map_id: str, user_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        m = self.get_user_map(map_id, user_id)
        if not m or not m["is_owner"]:
            return None

        allowed = ["name", "description", "province", "center_lon", "center_lat", "zoom_level", "basemap", "is_public"]
        set_clauses = []
        vals = []

        for k in allowed:
            if k in updates:
                set_clauses.append(f"{k} = ?")
                vals.append(int(updates[k]) if k == "is_public" else updates[k])

        if not set_clauses:
            return m

        now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        set_clauses.append("updated_at = ?")
        vals.append(now_str)

        vals.append(map_id)
        vals.append(user_id)

        with self._get_connection() as conn:
            cur = conn.cursor()
            cur.execute(f"""
                UPDATE user_maps SET {', '.join(set_clauses)}
                WHERE id = ? AND user_id = ?
            """, tuple(vals))
            conn.commit()

        return self.get_user_map(map_id, user_id)

    def delete_user_map(self, map_id: str, user_id: str) -> bool:
        with self._get_connection() as conn:
            cur = conn.cursor()
            # Delete private layer files
            cur.execute("SELECT geojson_path FROM user_layers WHERE map_id = ? AND user_id = ?", (map_id, user_id))
            for row in cur.fetchall():
                path = row["geojson_path"]
                if os.path.exists(path):
                    try:
                        os.remove(path)
                    except Exception:
                        pass

            cur.execute("DELETE FROM user_maps WHERE id = ? AND user_id = ?", (map_id, user_id))
            conn.commit()
            return cur.rowcount > 0

    # --- MAP PRIVATE LAYERS ---

    def list_map_layers(self, map_id: str, user_id: str) -> Dict[str, Any]:
        """
        Returns private layers belonging to this map workspace,
        PLUS system shared layers available across the platform.
        """
        private_layers = []
        with self._get_connection() as conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT * FROM user_layers 
                WHERE map_id = ? AND user_id = ?
                ORDER BY created_at ASC
            """, (map_id, user_id))
            rows = cur.fetchall()

        for r in rows:
            lbl_conf = {}
            try:
                lbl_conf = json.loads(r["label_config"] or "{}")
            except Exception:
                pass

            private_layers.append({
                "id": r["id"],
                "map_id": r["map_id"],
                "user_id": r["user_id"],
                "name": r["name"],
                "source_type": r["source_type"],
                "province": r["province"],
                "feature_count": r["feature_count"],
                "total_area_ha": r["total_area_ha"],
                "opacity": r["opacity"],
                "visible": bool(r["visible"]),
                "label_config": lbl_conf,
                "palette_color": r["palette_color"],
                "is_private": True,
                "created_at": r["created_at"]
            })

        # Load system shared layers from layers_catalog.json
        from layer_manager import layer_manager
        system_catalog = layer_manager.get_catalog()
        system_layers = []
        for l in system_catalog:
            l_copy = dict(l)
            l_copy["is_private"] = False
            l_copy["is_system"] = True
            system_layers.append(l_copy)

        return {
            "map_id": map_id,
            "private_layers": private_layers,
            "system_layers": system_layers
        }

    def add_user_layer(self, map_id: str, user_id: str, name: str,
                       geojson_data: Dict[str, Any], source_type: str = "Bản đồ cá nhân",
                       province: str = "Quảng Ngãi", palette_color: str = "#10b981") -> Dict[str, Any]:
        layer_id = f"usrlyr_{secrets.token_hex(6)}"
        user_folder = os.path.join(USER_LAYERS_DIR, user_id)
        os.makedirs(user_folder, exist_ok=True)
        geojson_path = os.path.join(user_folder, f"{layer_id}.geojson")

        features = geojson_data.get("features", [])
        total_area = 0.0
        for f in features:
            props = f.get("properties", {})
            a = props.get("area_ha") or props.get("dien_tich") or 0.0
            try:
                total_area += float(a or 0.0)
            except (ValueError, TypeError):
                pass

        with open(geojson_path, "w", encoding="utf-8") as f:
            json.dump(geojson_data, f, ensure_ascii=False)

        now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        with self._get_connection() as conn:
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO user_layers (id, map_id, user_id, name, source_type, province, geojson_path, feature_count, total_area_ha, opacity, visible, palette_color, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (layer_id, map_id, user_id, name.strip(), source_type, province, geojson_path, len(features), round(total_area, 2), 0.8, 1, palette_color, now_str))
            
            # Touch map updated_at
            cur.execute("UPDATE user_maps SET updated_at = ? WHERE id = ?", (now_str, map_id))
            conn.commit()

        return {
            "id": layer_id,
            "map_id": map_id,
            "user_id": user_id,
            "name": name.strip(),
            "source_type": source_type,
            "province": province,
            "feature_count": len(features),
            "total_area_ha": round(total_area, 2),
            "opacity": 0.8,
            "visible": True,
            "palette_color": palette_color,
            "is_private": True,
            "created_at": now_str
        }

    def get_user_layer_geojson(self, layer_id: str, user_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        with self._get_connection() as conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM user_layers WHERE id = ?", (layer_id,))
            r = cur.fetchone()

        if not r:
            return None

        # Check permission
        if user_id and r["user_id"] != user_id:
            # Check if map is public
            cur.execute("SELECT is_public FROM user_maps WHERE id = ?", (r["map_id"],))
            m = cur.fetchone()
            if not m or not m["is_public"]:
                return None

        geojson_path = r["geojson_path"]
        if not os.path.exists(geojson_path):
            return None

        with open(geojson_path, "r", encoding="utf-8") as f:
            return json.load(f)

    def save_user_layer_features(self, layer_id: str, user_id: str, geojson_data: Dict[str, Any]) -> bool:
        with self._get_connection() as conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM user_layers WHERE id = ? AND user_id = ?", (layer_id, user_id))
            r = cur.fetchone()

        if not r:
            return False

        geojson_path = r["geojson_path"]
        with open(geojson_path, "w", encoding="utf-8") as f:
            json.dump(geojson_data, f, ensure_ascii=False)

        features = geojson_data.get("features", [])
        total_area = sum(float(f.get("properties", {}).get("area_ha") or 0.0) for f in features)

        now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with self._get_connection() as conn:
            cur = conn.cursor()
            cur.execute("""
                UPDATE user_layers 
                SET feature_count = ?, total_area_ha = ?
                WHERE id = ? AND user_id = ?
            """, (len(features), round(total_area, 2), layer_id, user_id))
            cur.execute("UPDATE user_maps SET updated_at = ? WHERE id = ?", (now_str, r["map_id"]))
            conn.commit()

        return True

    def delete_user_layer(self, layer_id: str, user_id: str) -> bool:
        with self._get_connection() as conn:
            cur = conn.cursor()
            cur.execute("SELECT geojson_path, map_id FROM user_layers WHERE id = ? AND user_id = ?", (layer_id, user_id))
            r = cur.fetchone()
            if not r:
                return False

            path = r["geojson_path"]
            if os.path.exists(path):
                try:
                    os.remove(path)
                except Exception:
                    pass

            cur.execute("DELETE FROM user_layers WHERE id = ? AND user_id = ?", (layer_id, user_id))
            now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            cur.execute("UPDATE user_maps SET updated_at = ? WHERE id = ?", (now_str, r["map_id"]))
            conn.commit()
            return True

user_map_manager = UserMapManager()
