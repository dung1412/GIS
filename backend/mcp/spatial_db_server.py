"""
MCP Server for Central Vietnam Forestry WebGIS Databases (Phú Tài Bioenergy).
Provides high-speed queries on:
  1. data/layers/layer_f3f5750f.sqlite (308,258 plots with R-Tree spatial indexing)
  2. data/webgis.db (users, workspaces, user layers, bookmarks)
"""

import sys
import os
import json
import sqlite3
from typing import List, Dict, Any, Optional

# Ensure project root is in python path
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from mcp.server.mcpserver import MCPServer

SQLITE_LAYER_PATH = os.path.join(ROOT_DIR, "data", "layers", "layer_f3f5750f.sqlite")
WEBGIS_DB_PATH = os.path.join(ROOT_DIR, "data", "webgis.db")

server = MCPServer(
    name="webgis-spatial-db",
    version="1.0.0",
    description="Spatial Database Server for Central Vietnam Forestry WebGIS (Phú Tài Bioenergy)"
)

def get_ro_connection(db_path: str):
    if not os.path.exists(db_path):
        raise FileNotFoundError(f"Database not found at {db_path}")
    uri = f"file:{os.path.abspath(db_path)}?mode=ro"
    return sqlite3.connect(uri, uri=True)

@server.tool()
def search_forest_plots(
    query: str = "",
    province: str = "",
    district: str = "",
    commune: str = "",
    limit: int = 20
) -> Dict[str, Any]:
    """
    Search across 308,258 forest plots in Central Vietnam (Quảng Ngãi, Bình Định, Phú Yên).
    Matches plot ID, owner name (chủ rừng), CCCD/CMND, redbook number (số sổ đỏ),
    sub-compartment (tiểu khu), compartment (khoảnh), and lot (lô).
    """
    limit = max(1, min(limit, 100))
    con = get_ro_connection(SQLITE_LAYER_PATH)
    cur = con.cursor()

    conditions = []
    params = []

    q = query.lower().strip()
    if q:
        conditions.append("(lower(props) LIKE ? OR lower(id) LIKE ?)")
        params.extend([f"%{q}%", f"%{q}%"])

    if province and "tất cả" not in province.lower():
        conditions.append("json_extract(props, '$.province') = ?")
        params.append(province)

    if district and "tất cả" not in district.lower():
        conditions.append("json_extract(props, '$.district') = ?")
        params.append(district)

    if commune and "tất cả" not in commune.lower():
        conditions.append("json_extract(props, '$.commune') = ?")
        params.append(commune)

    where_clause = (" WHERE " + " AND ".join(conditions)) if conditions else ""

    # Fetch rows directly with limit + 1 to check if has_more without doing an expensive count(*)
    cur.execute(f"SELECT id, props FROM features{where_clause} LIMIT ?", (*params, limit + 1))
    rows = cur.fetchall()
    con.close()

    has_more = len(rows) > limit
    returned_rows = rows[:limit]

    results = []
    for plot_id, props_json in returned_rows:
        props = json.loads(props_json)
        results.append({
            "id": plot_id,
            "owner_name": props.get("owner_name", ""),
            "cccd": props.get("cccd", ""),
            "redbook_no": props.get("redbook_no", ""),
            "province": props.get("province", ""),
            "district": props.get("district", ""),
            "commune": props.get("commune", ""),
            "sub_compartment": props.get("sub_compartment", ""),
            "compartment": props.get("compartment", ""),
            "lot": props.get("lot", ""),
            "area_ha": props.get("area_ha", 0.0),
            "source_type": props.get("source_type", "Kiểm kê rừng")
        })

    return {
        "returned_count": len(results),
        "has_more": has_more,
        "plots": results
    }

@server.tool()
def get_plot_details(plot_id: str) -> Dict[str, Any]:
    """
    Get full attributes, geometry coordinates (GeoJSON Polygon/MultiPolygon),
    and bounding box for a specific forest parcel by its ID.
    Uses idx_features_id index for instant response.
    """
    con = get_ro_connection(SQLITE_LAYER_PATH)
    cur = con.cursor()
    target_id = plot_id.strip()
    cur.execute("SELECT id, props, geom FROM features WHERE id = ?", (target_id,))
    row = cur.fetchone()
    if not row:
        cur.execute("SELECT id, props, geom FROM features WHERE id = ?", (target_id.upper(),))
        row = cur.fetchone()
    con.close()

    if not row:
        return {"found": False, "error": f"Plot ID '{plot_id}' not found in spatial database."}

    p_id, props_json, geom_json = row
    props = json.loads(props_json)
    geom = json.loads(geom_json) if geom_json else {}

    return {
        "found": True,
        "id": p_id,
        "properties": props,
        "geometry": geom
    }

@server.tool()
def query_plots_by_bbox(
    min_lon: float,
    min_lat: float,
    max_lon: float,
    max_lat: float,
    limit: int = 50
) -> Dict[str, Any]:
    """
    High-speed spatial BBOX query using SQLite R-Tree index.
    Returns plots intersecting the specified bounding box (coordinates in WGS84 EPSG:4326).
    """
    limit = max(1, min(limit, 200))
    con = get_ro_connection(SQLITE_LAYER_PATH)
    cur = con.cursor()

    cur.execute("""
        SELECT f.id, f.props
        FROM rtree_idx r
        JOIN features f ON f.rowid = r.fid
        WHERE r.minx <= ? AND r.maxx >= ?
          AND r.miny <= ? AND r.maxy >= ?
        LIMIT ?
    """, (max_lon, min_lon, max_lat, min_lat, limit))

    rows = cur.fetchall()
    con.close()

    results = []
    for plot_id, props_json in rows:
        props = json.loads(props_json)
        results.append({
            "id": plot_id,
            "owner": props.get("owner_name", ""),
            "province": props.get("province", ""),
            "district": props.get("district", ""),
            "commune": props.get("commune", ""),
            "area_ha": props.get("area_ha", 0.0)
        })

    return {
        "bbox": [min_lon, min_lat, max_lon, max_lat],
        "count": len(results),
        "plots": results
    }

@server.tool()
def get_database_overview() -> Dict[str, Any]:
    """
    Get summary statistics of the WebGIS spatial database, total parcels,
    and user account overview.
    """
    total_plots = 308253
    idx_path = os.path.join(ROOT_DIR, "data", "layers", "layer_f3f5750f_index.json")
    if os.path.exists(idx_path):
        try:
            with open(idx_path, "r", encoding="utf-8") as f:
                # Just read the first 50 chars which contains "total": 308253
                head = f.read(60)
                import re
                m = re.search(r'"total"\s*:\s*(\d+)', head)
                if m:
                    total_plots = int(m.group(1))
        except Exception:
            pass

    # WebGIS user DB stats
    total_users = 0
    total_maps = 0
    try:
        con_web = get_ro_connection(WEBGIS_DB_PATH)
        cur_web = con_web.cursor()
        cur_web.execute("SELECT count(*) FROM users")
        total_users = cur_web.fetchone()[0]
        cur_web.execute("SELECT count(*) FROM user_maps")
        total_maps = cur_web.fetchone()[0]
        con_web.close()
    except Exception:
        pass

    return {
        "spatial_database": {
            "total_forest_plots": total_plots,
            "target_provinces": ["Quảng Ngãi (QNG)", "Bình Định (BDH)", "Phú Yên (PYE)"],
            "indexing": "SQLite R-Tree 2D Spatial Indexing"
        },
        "system_database": {
            "total_registered_users": total_users,
            "saved_workspaces_maps": total_maps
        }
    }

@server.tool()
def execute_readonly_sql(database: str, query: str, limit: int = 50) -> Dict[str, Any]:
    """
    Execute a custom read-only SQL query against either 'layer_db' or 'webgis_db'.
    Only SELECT statements are allowed.
    """
    clean_q = query.strip()
    if not clean_q.lower().startswith("select"):
        return {"error": "Only SELECT queries are permitted on this MCP Server."}

    target_path = SQLITE_LAYER_PATH if "layer" in database.lower() else WEBGIS_DB_PATH
    con = get_ro_connection(target_path)
    con.row_factory = sqlite3.Row
    cur = con.cursor()

    try:
        cur.execute(clean_q)
        rows = cur.fetchmany(max(1, min(limit, 200)))
        columns = [d[0] for d in cur.description] if cur.description else []
        results = [dict(r) for r in rows]
        con.close()
        return {
            "database": os.path.basename(target_path),
            "columns": columns,
            "row_count": len(results),
            "rows": results
        }
    except Exception as e:
        con.close()
        return {"error": str(e)}

if __name__ == "__main__":
    server.run(transport="stdio")
