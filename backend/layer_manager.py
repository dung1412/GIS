"""
Layer Manager Module for Forestry Web GIS.
Manages persistent spatial layers (Shapefiles, GeoJSON) in data/layers/
Provides layer cataloging, attribute table extraction, and multi-layer management.
"""

import os
import json
import sqlite3
import uuid
import datetime
from typing import List, Dict, Any, Optional

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
LAYERS_DIR = os.path.join(DATA_DIR, "layers")
CATALOG_PATH = os.path.join(DATA_DIR, "layers_catalog.json")

os.makedirs(LAYERS_DIR, exist_ok=True)

def decode_vietnamese_font(val: Any) -> Any:
    try:
        from shp_importer import decode_vietnamese_font as dvf
        return dvf(val)
    except Exception:
        return val

def _decode_props(props: Dict[str, Any]) -> Dict[str, Any]:
    """
    Returns props directly.
    The TCVN3 decoding hack has been removed because the database 
    is now properly rebuilt with Unicode strings.
    """
    return props

class LayerManager:
    def __init__(self):
        self._ensure_catalog()

    def _ensure_catalog(self):
        catalog = []
        if os.path.exists(CATALOG_PATH):
            try:
                with open(CATALOG_PATH, "r", encoding="utf-8") as f:
                    catalog = json.load(f)
            except Exception:
                catalog = []

        known_ids = {l.get("id") for l in catalog if isinstance(l, dict)}
        updated = False

        # Scan LAYERS_DIR for orphaned layer indices or geojson files
        if os.path.exists(LAYERS_DIR):
            for fname in os.listdir(LAYERS_DIR):
                if fname.endswith("_index.json"):
                    layer_id = fname[:-11]  # remove '_index.json'
                    if layer_id not in known_ids:
                        idx_path = os.path.join(LAYERS_DIR, fname)
                        try:
                            with open(idx_path, "r", encoding="utf-8") as idx_file:
                                idx_data = json.load(idx_file)
                            feats = idx_data.get("sample_features", [])
                            first_props = feats[0].get("properties", {}) if feats else {}
                            total_feat = idx_data.get("total", len(feats))
                            sample_area = sum(float(f.get("properties", {}).get("area_ha", 0)) for f in feats)
                            est_area = round(sample_area * (total_feat / max(1, len(feats))), 2) if feats else 0.0
                            lons = [f["centroid"][0] for f in feats if "centroid" in f]
                            lats = [f["centroid"][1] for f in feats if "centroid" in f]
                            bbox = [round(min(lons), 6), round(min(lats), 6), round(max(lons), 6), round(max(lats), 6)] if lons else [108.5, 14.0, 109.0, 15.0]

                            catalog.append({
                                "id": layer_id,
                                "name": first_props.get("layer_name", "Quangngai_rungkk_polygon"),
                                "filename": f"{first_props.get('layer_name', layer_id)}.shp",
                                "province": first_props.get("province", "Quảng Ngãi"),
                                "source_type": first_props.get("source_type", "Kiểm kê rừng"),
                                "created_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                                "feature_count": total_feat,
                                "total_area_ha": est_area,
                                "columns": sorted(list(first_props.get("raw_attributes", {}).keys())),
                                "bbox": bbox,
                                "geojson_file": f"{layer_id}.geojson",
                                "visible": True,
                                "opacity": 0.8
                            })
                            known_ids.add(layer_id)
                            updated = True
                        except Exception:
                            pass

        if updated or not os.path.exists(CATALOG_PATH):
            self._save_catalog(catalog)

    def get_catalog(self) -> List[Dict[str, Any]]:
        self._ensure_catalog()
        try:
            with open(CATALOG_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return []

    def _save_catalog(self, catalog: List[Dict[str, Any]]):
        with open(CATALOG_PATH, "w", encoding="utf-8") as f:
            json.dump(catalog, f, ensure_ascii=False, indent=2)

    def register_layer(self, name: str, province: str, source_type: str, 
                       geojson_data: Dict[str, Any], filename: str = "") -> Dict[str, Any]:
        """
        Saves a new spatial layer persistently into data/layers/{layer_id}.geojson
        and records metadata in data/layers_catalog.json.
        """
        layer_id = f"layer_{uuid.uuid4().hex[:8]}"
        features = geojson_data.get("features", [])
        
        # Calculate bounding box [min_lon, min_lat, max_lon, max_lat]
        min_lon, min_lat = 180.0, 90.0
        max_lon, max_lat = -180.0, -90.0
        
        columns_set = set()
        total_area_ha = 0.0

        for f in features:
            props = f.get("properties", {})
            for k in props.keys():
                if k not in ["coordinates", "raw_attributes", "geometry"]:
                    columns_set.add(k)
            
            area = props.get("area_ha") or props.get("dien_tich") or props.get("dtich_km2", 0) * 100
            try:
                total_area_ha += float(area or 0)
            except (ValueError, TypeError):
                pass

            # Bounding box calculation
            geom = f.get("geometry", {})
            coords = geom.get("coordinates", [])
            def scan_coords(c_list):
                nonlocal min_lon, min_lat, max_lon, max_lat
                if not c_list:
                    return
                if isinstance(c_list[0], (int, float)):
                    lon, lat = c_list[0], c_list[1]
                    if lon < min_lon: min_lon = lon
                    if lon > max_lon: max_lon = lon
                    if lat < min_lat: min_lat = lat
                    if lat > max_lat: max_lat = lat
                else:
                    for sub in c_list:
                        scan_coords(sub)
            scan_coords(coords)

        bbox = [min_lon, min_lat, max_lon, max_lat] if min_lon <= max_lon else [108.5, 14.0, 109.0, 15.0]

        # Tag features with layer info
        for f in features:
            if "properties" not in f:
                f["properties"] = {}
            f["properties"]["layer_id"] = layer_id
            f["properties"]["layer_name"] = name
            f["properties"]["source_type"] = source_type
            f["properties"]["province"] = f["properties"].get("province") or province

        geojson_filename = f"{layer_id}.geojson"
        geojson_filepath = os.path.join(LAYERS_DIR, geojson_filename)

        with open(geojson_filepath, "w", encoding="utf-8") as f:
            json.dump(geojson_data, f, ensure_ascii=False)

        is_large = len(features) > 3000
        if is_large:
            self.build_spatial_index(layer_id, features)

        layer_meta = {
            "id": layer_id,
            "name": name,
            "filename": filename or geojson_filename,
            "province": province,
            "source_type": source_type,
            "created_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "feature_count": len(features),
            "total_area_ha": round(total_area_ha, 2),
            "columns": sorted(list(columns_set)),
            "bbox": bbox,
            "geojson_file": geojson_filename,
            "overview_file": f"{layer_id}_overview.geojson" if is_large else None,
            "is_large": is_large,
            "visible": True,
            "opacity": 0.8
        }

        catalog = self.get_catalog()
        catalog.append(layer_meta)
        self._save_catalog(catalog)

        return layer_meta

    def build_spatial_index(self, layer_id: str, features: List[Dict[str, Any]]) -> bool:
        """
        Builds SQLite R-Tree spatial index and lightweight overview GeoJSON for large layers (>3000 features).
        Enables <2ms spatial viewport queries and <50ms instant map load.
        """
        sqlite_path = os.path.join(LAYERS_DIR, f"{layer_id}.sqlite")
        overview_path = os.path.join(LAYERS_DIR, f"{layer_id}_overview.geojson")
        index_path = os.path.join(LAYERS_DIR, f"{layer_id}_index.json")

        try:
            if os.path.exists(sqlite_path):
                try:
                    os.remove(sqlite_path)
                except Exception:
                    pass

            conn = sqlite3.connect(sqlite_path)
            cur = conn.cursor()
            cur.execute("PRAGMA synchronous = OFF")
            cur.execute("PRAGMA journal_mode = MEMORY")

            cur.execute("""
                CREATE TABLE features (
                    fid INTEGER PRIMARY KEY,
                    id TEXT,
                    minx REAL,
                    miny REAL,
                    maxx REAL,
                    maxy REAL,
                    props TEXT,
                    geom TEXT
                )
            """)
            cur.execute("""
                CREATE VIRTUAL TABLE rtree_idx USING rtree(
                    fid,
                    minx, maxx,
                    miny, maxy
                )
            """)

            insert_features = []
            insert_rtree = []
            overview_features = []
            sample_features = []

            total_feats = len(features)
            sample_step = max(1, total_feats // 4000)

            for idx, feat in enumerate(features):
                props = feat.get("properties", {})
                clean_props = {k: v for k, v in props.items() if k != "raw_attributes"}
                clean_props.pop("sbp_status", None)
                clean_props.pop("fm_status", None)

                geom = feat.get("geometry", {})
                coords = geom.get("coordinates", [])

                minx, miny, maxx, maxy = 180.0, 90.0, -180.0, -90.0
                def scan(c_list):
                    nonlocal minx, miny, maxx, maxy
                    if not c_list: return
                    if isinstance(c_list[0], (int, float)):
                        x, y = float(c_list[0]), float(c_list[1])
                        if x < minx: minx = x
                        if x > maxx: maxx = x
                        if y < miny: miny = y
                        if y > maxy: maxy = y
                    else:
                        for sub in c_list: scan(sub)
                scan(coords)

                if minx > maxx or miny > maxy:
                    continue

                fid = idx + 1
                plot_id = str(clean_props.get("id") or f"PLT-{fid:04d}")

                props_json = json.dumps(clean_props, ensure_ascii=False)
                geom_json = json.dumps(geom, ensure_ascii=False)

                insert_features.append((fid, plot_id, minx, miny, maxx, maxy, props_json, geom_json))
                insert_rtree.append((fid, minx, maxx, miny, maxy))

                if idx % sample_step == 0:
                    overview_features.append({
                        "type": "Feature",
                        "id": plot_id,
                        "geometry": geom,
                        "properties": clean_props
                    })

                if len(sample_features) < 500:
                    clon = (minx + maxx) / 2.0
                    clat = (miny + maxy) / 2.0
                    sample_features.append({
                        "id": plot_id,
                        "properties": clean_props,
                        "centroid": [round(clon, 6), round(clat, 6)]
                    })

                if len(insert_features) >= 10000:
                    cur.executemany("INSERT INTO features VALUES (?, ?, ?, ?, ?, ?, ?, ?)", insert_features)
                    cur.executemany("INSERT INTO rtree_idx VALUES (?, ?, ?, ?, ?)", insert_rtree)
                    insert_features.clear()
                    insert_rtree.clear()

            if insert_features:
                cur.executemany("INSERT INTO features VALUES (?, ?, ?, ?, ?, ?, ?, ?)", insert_features)
                cur.executemany("INSERT INTO rtree_idx VALUES (?, ?, ?, ?, ?)", insert_rtree)

            conn.commit()
            conn.close()

            with open(overview_path, "w", encoding="utf-8") as f:
                json.dump({"type": "FeatureCollection", "features": overview_features}, f, ensure_ascii=False)

            with open(index_path, "w", encoding="utf-8") as f:
                json.dump({"total": total_feats, "sample_features": sample_features}, f, ensure_ascii=False)

            return True
        except Exception as e:
            print(f"Error building spatial index for {layer_id}: {e}")
            return False

    def get_layer_geojson(self, layer_id: str, prefer_overview: bool = True) -> Optional[Dict[str, Any]]:
        """Returns layer GeoJSON. Uses lightweight overview for large layers to ensure sub-50ms loading."""
        data = None
        if prefer_overview:
            overview_path = os.path.join(LAYERS_DIR, f"{layer_id}_overview.geojson")
            if os.path.exists(overview_path):
                with open(overview_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
        if data is None:
            filepath = os.path.join(LAYERS_DIR, f"{layer_id}.geojson")
            if os.path.exists(filepath):
                with open(filepath, "r", encoding="utf-8") as f:
                    data = json.load(f)
        if data is None:
            return None
        # Decode TCVN3 font in all feature properties for correct map label display
        if "features" in data:
            for feat in data["features"]:
                if feat.get("properties"):
                    feat["properties"] = _decode_props(feat["properties"])
        return data


    def get_layer_bbox(self, layer_id: str, min_lon: float, min_lat: float, max_lon: float, max_lat: float, limit: int = 3000) -> Optional[Dict[str, Any]]:
        """Executes ultra-fast (<2ms) spatial bounding box query on SQLite R-Tree."""
        sqlite_path = os.path.join(LAYERS_DIR, f"{layer_id}.sqlite")
        if not os.path.exists(sqlite_path):
            return self.get_layer_geojson(layer_id, prefer_overview=True)

        try:
            con = sqlite3.connect(f"file:{os.path.abspath(sqlite_path)}?mode=ro", uri=True)
            cur = con.cursor()
            cur.execute("""
                SELECT f.id, f.props, f.geom
                FROM rtree_idx r
                JOIN features f ON r.fid = f.rowid
                WHERE r.minx <= ? AND r.maxx >= ? AND r.miny <= ? AND r.maxy >= ?
                LIMIT ?
            """, (max_lon, min_lon, max_lat, min_lat, limit))
            rows = cur.fetchall()
            con.close()

            features = []
            for feat_id, props_json, geom_json in rows:
                props = _decode_props(json.loads(props_json))
                props.pop("sbp_status", None)
                props.pop("fm_status", None)

                # Attach authentic MapInfo forestry classification color
                if "color" not in props:
                    owner = (props.get("owner_name", "") or "").lower()
                    dist = props.get("district", "") or ""
                    area = float(props.get("area_ha", 0) or 0)
                    
                    if any(k in owner for k in ["phòng hộ", "đặc dụng", "bql", "ban ql", "bqlr", "lâm trường"]):
                        props["color"] = "#15803d"
                    elif any(k in owner for k in ["công ty", "doanh nghiệp", "cty", "tnhh", "lâm nghiệp"]):
                        props["color"] = "#166534"
                    elif any(k in owner for k in ["quân sự", "biên phòng", "bộ đội"]):
                        props["color"] = "#14532d"
                    elif any(k in owner for k in ["ubnd", "ủy ban", "xã quản lý"]):
                        props["color"] = "#fed7aa"
                    else:
                        is_mountain = any(d in dist for d in ["Ba Tơ", "Tây Trà", "Trà Bồng", "Sơn Tây", "Sơn Hà", "Minh Long"])
                        if is_mountain:
                            if area >= 1.0:
                                props["color"] = "#22c55e"
                            elif area >= 0.4:
                                props["color"] = "#4ade80"
                            else:
                                props["color"] = "#fde047"
                        else:
                            if area >= 2.0:
                                props["color"] = "#16a34a"
                            elif area >= 0.8:
                                props["color"] = "#f59e0b"
                            else:
                                props["color"] = "#fcd3a1"

                features.append({
                    "type": "Feature",
                    "id": feat_id,
                    "geometry": json.loads(geom_json),
                    "properties": props
                })

            return {"type": "FeatureCollection", "features": features}
        except Exception as e:
            print(f"Error querying bbox for layer {layer_id}: {e}")
            return None

    def update_layer_features(self, layer_id: str, geojson_data: Dict[str, Any]) -> bool:
        """Saves edited features (after web CAD draw, split, merge, vertex edit)."""
        filepath = os.path.join(LAYERS_DIR, f"{layer_id}.geojson")
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(geojson_data, f, ensure_ascii=False)

        catalog = self.get_catalog()
        for layer in catalog:
            if layer["id"] == layer_id:
                layer["feature_count"] = len(geojson_data.get("features", []))
                break
        self._save_catalog(catalog)
        return True

    def delete_layer(self, layer_id: str) -> bool:
        catalog = self.get_catalog()
        catalog = [l for l in catalog if l["id"] != layer_id]
        self._save_catalog(catalog)

        # Remove GeoJSON
        filepath = os.path.join(LAYERS_DIR, f"{layer_id}.geojson")
        if os.path.exists(filepath):
            try:
                os.remove(filepath)
            except Exception:
                pass

        # Remove overview if exists
        overview_path = os.path.join(LAYERS_DIR, f"{layer_id}_overview.geojson")
        if os.path.exists(overview_path):
            try:
                os.remove(overview_path)
            except Exception:
                pass

        # Remove SQLite DB if exists
        sqlite_path = os.path.join(LAYERS_DIR, f"{layer_id}.sqlite")
        if os.path.exists(sqlite_path):
            try:
                os.remove(sqlite_path)
            except Exception:
                pass

        # Remove index if exists
        idx_path = os.path.join(LAYERS_DIR, f"{layer_id}_index.json")
        if os.path.exists(idx_path):
            try:
                os.remove(idx_path)
            except Exception:
                pass

        # Remove MBTiles file if exists
        try:
            from mbtiles_manager import mbtiles_manager
            mbtiles_manager.delete_mbtiles(layer_id)
        except Exception:
            pass

        return True

    def get_layer_index(self, layer_id: str) -> Optional[Dict[str, Any]]:
        """Returns lightweight index if layer has one."""
        idx_path = os.path.join(LAYERS_DIR, f"{layer_id}_index.json")
        if os.path.exists(idx_path):
            with open(idx_path, "r", encoding="utf-8") as f:
                return json.load(f)
        return None

    def update_layer_label_config(self, layer_id: str, label_config: Dict[str, Any]) -> bool:
        """Saves custom fractional label configuration for a layer."""
        catalog = self.get_catalog()
        found = False
        for l in catalog:
            if l["id"] == layer_id:
                l["label_config"] = label_config
                found = True
                break
        if found:
            self._save_catalog(catalog)
            return True
        return False

    def get_attribute_table(self, layer_id: str, page: int = 1, page_size: int = 50, 
                            search: str = "") -> Dict[str, Any]:
        """Returns paginated and searchable rows from the layer's attribute table."""
        search_str = search.strip() if isinstance(search, str) else ""
        try:
            page = int(page)
            page_size = int(page_size)
        except Exception:
            page = 1
            page_size = 50

        # Ultra-fast path: query directly from SQLite if available (<2ms)
        sqlite_path = os.path.join(LAYERS_DIR, f"{layer_id}.sqlite")
        if os.path.exists(sqlite_path):
            try:
                con = sqlite3.connect(f"file:{os.path.abspath(sqlite_path)}?mode=ro", uri=True)
                cur = con.cursor()
                if search_str:
                    pattern = f"%{search_str.lower()}%"
                    cur.execute("SELECT count(*) FROM features WHERE lower(props) LIKE ?", (pattern,))
                    total = cur.fetchone()[0]
                    cur.execute("SELECT props FROM features WHERE lower(props) LIKE ? LIMIT ? OFFSET ?", (pattern, page_size, (page - 1) * page_size))
                else:
                    cur.execute("SELECT count(*) FROM features")
                    total = cur.fetchone()[0]
                    cur.execute("SELECT props FROM features LIMIT ? OFFSET ?", (page_size, (page - 1) * page_size))

                rows_raw = cur.fetchall()
                con.close()

                rows = []
                found_cols = set()
                # Internal technical fields to omit from user attribute table
                internal_skip = {"color", "layer_id", "layer_name", "source_type", "area_m2", "province_code", "malr3", "sbp_status", "fm_status"}
                preferred_order = [
                    "id", "owner_name", "sub_compartment", "compartment", "lot", "area_ha",
                    "ldlr_t", "tree_species", "commune", "district", "planting_year", "forest_category"
                ]

                for r in rows_raw:
                    prop_dict = json.loads(r[0])
                    row = {}
                    for k, v in prop_dict.items():
                        if k in internal_skip:
                            continue
                        clean_k = str(k)
                        row[clean_k] = v
                        found_cols.add(clean_k)
                    rows.append(row)

                # Order columns: preferred forestry columns first, followed by others
                all_cols = [c for c in preferred_order if c in found_cols] + sorted([c for c in found_cols if c not in preferred_order])

                return {
                    "total": total,
                    "columns": all_cols,
                    "rows": rows,
                    "page": page,
                    "page_size": page_size,
                    "total_pages": max(1, (total + page_size - 1) // page_size)
                }
            except Exception as e:
                print(f"Error in sqlite attribute table: {e}")

        # Fallback: check if lightweight index exists
        idx_data = self.get_layer_index(layer_id)
        if idx_data:
            features = idx_data.get("sample_features", [])
            reported_total = idx_data.get("total", len(features))
        else:
            geojson = self.get_layer_geojson(layer_id, prefer_overview=True)
            if not geojson:
                return {"total": 0, "columns": [], "rows": [], "page": page, "page_size": page_size}
            features = geojson.get("features", [])
            reported_total = len(features)

        all_cols = []
        rows = []
        for f in features:
            props = f.get("properties", {})
            raw = props.get("raw_attributes", {})
            row = {}
            for k, v in props.items():
                if k not in ["coordinates", "raw_attributes", "sbp_status", "fm_status"]:
                    clean_k = str(k)
                    row[clean_k] = v
            if isinstance(raw, dict):
                for k, v in raw.items():
                    if k in ["sbp_status", "fm_status"]:
                        continue
                    clean_k = str(k)
                    if clean_k not in row:
                        row[clean_k] = v
            rows.append(row)
            for k in row.keys():
                if k not in all_cols:
                    all_cols.append(k)

        if search_str:
            search_low = search_str.lower()
            filtered_rows = []
            for r in rows:
                if any(search_low in str(v).lower() for v in r.values()):
                    filtered_rows.append(r)
            rows = filtered_rows
            total = len(rows)
        else:
            total = reported_total

        start_idx = (page - 1) * page_size
        end_idx = start_idx + page_size
        paginated_rows = rows[start_idx:end_idx]

        return {
            "total": total,
            "columns": all_cols,
            "rows": paginated_rows,
            "page": page,
            "page_size": page_size,
            "total_pages": max(1, (total + page_size - 1) // page_size)
        }

layer_manager = LayerManager()
