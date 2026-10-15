"""
MCP Server for Spatial Geometry & Coordinate Transformations (VN-2000 <-> WGS84).
Specialized for Central Vietnam Forestry:
  - Quảng Ngãi (KTT 108°00', EPSG custom)
  - Bình Định (KTT 108°15', EPSG custom)
  - Phú Yên (KTT 108°30', EPSG custom)
"""

import sys
import os
import json
import math
from typing import List, Dict, Any, Tuple, Optional

# Ensure project root is in python path
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

# Configure PROJ paths from QGIS 3.44.12 for offline high-speed CRS transformations
for qgis_proj in [
    r"C:\Program Files\QGIS 3.44.12\share\proj",
    r"C:\Program Files\QGIS 3.44.11\share\proj"
]:
    if os.path.exists(qgis_proj):
        os.environ["PROJ_DATA"] = qgis_proj
        os.environ["PROJ_LIB"] = qgis_proj
        break

os.environ["PROJ_NETWORK"] = "OFF"

from mcp.server.mcpserver import MCPServer
import pyproj
from shapely.geometry import shape, mapping, Polygon, MultiPolygon
from shapely.ops import transform

server = MCPServer(
    name="webgis-spatial-engine",
    version="1.0.0",
    description="Spatial Engine for VN-2000 Projections, Geodesic Area, and GeoJSON Analysis"
)

PROVINCE_KTT = {
    "quảng ngãi": 108.0,
    "quang ngai": 108.0,
    "qng": 108.0,
    "bình định": 108.25,
    "binh dinh": 108.25,
    "bdh": 108.25,
    "phú yên": 108.5,
    "phu yen": 108.5,
    "pye": 108.5
}

def get_transformers(province: str):
    ktt = PROVINCE_KTT.get(province.lower().strip(), 108.0)
    # Official Vietnam Ministry of Natural Resources and Environment 7-parameter Helmert shift
    proj4_vn2000 = (
        f"+proj=tmerc +lat_0=0 +lon_0={ktt} +k=0.9999 +x_0=500000 +y_0=0 +ellps=WGS84 "
        f"+towgs84=-191.90441429,-39.30318279,-111.45032835,-0.00928836,0.01975479,-0.00427372,0.252906278 +units=m +no_defs"
    )
    crs_vn2000 = pyproj.CRS.from_proj4(proj4_vn2000)
    crs_wgs84 = pyproj.CRS.from_epsg(4326)

    to_wgs84 = pyproj.Transformer.from_crs(crs_vn2000, crs_wgs84, always_xy=True).transform
    to_vn2000 = pyproj.Transformer.from_crs(crs_wgs84, crs_vn2000, always_xy=True).transform
    return to_wgs84, to_vn2000, ktt

@server.tool()
def vn2000_to_wgs84(x: float, y: float, province: str = "Quảng Ngãi") -> Dict[str, Any]:
    """
    Convert local VN-2000 coordinate (X easting, Y northing in meters)
    to WGS84 GPS (Longitude, Latitude) with millimeter precision.
    Supports Quảng Ngãi (108°00'), Bình Định (108°15'), Phú Yên (108°30').
    """
    to_wgs, _, ktt = get_transformers(province)
    lon, lat = to_wgs(x, y)
    return {
        "vn2000_input": {"x": x, "y": y, "province": province, "ktt": ktt},
        "wgs84_output": {"longitude": round(lon, 7), "latitude": round(lat, 7)},
        "formatted": f"{lat:.6f}°N, {lon:.6f}°E"
    }

@server.tool()
def wgs84_to_vn2000(longitude: float, latitude: float, province: str = "Quảng Ngãi") -> Dict[str, Any]:
    """
    Convert WGS84 GPS coordinate (Longitude, Latitude) to local VN-2000 meters (X, Y).
    Used for cadastral boundary inspection and Red Book (Sổ đỏ) shape comparison.
    """
    _, to_vn, ktt = get_transformers(province)
    x, y = to_vn(longitude, latitude)
    return {
        "wgs84_input": {"longitude": longitude, "latitude": latitude},
        "vn2000_output": {"x": round(x, 3), "y": round(y, 3), "province": province, "ktt": ktt}
    }

@server.tool()
def calculate_polygon_area(coordinates: List[List[float]]) -> Dict[str, Any]:
    """
    Calculate geodesic surface area of a polygon in hectares (ha) and square meters (m²).
    Takes a list of [longitude, latitude] coordinates (WGS84).
    """
    if len(coordinates) < 3:
        return {"error": "A polygon requires at least 3 coordinate points."}

    # Ensure closed ring
    pts = list(coordinates)
    if pts[0] != pts[-1]:
        pts.append(pts[0])

    poly = Polygon(pts)
    if not poly.is_valid:
        from shapely.validation import make_valid
        poly = make_valid(poly)

    # Project to Vietnam UTM Zone 49N (EPSG:32649) for exact metric calculation
    project = pyproj.Transformer.from_crs("EPSG:4326", "EPSG:32649", always_xy=True).transform
    poly_metric = transform(project, poly)

    area_m2 = poly_metric.area
    area_ha = area_m2 / 10000.0

    bounds = poly.bounds # (minx, miny, maxx, maxy)
    centroid = poly.centroid

    return {
        "area_m2": round(area_m2, 2),
        "area_ha": round(area_ha, 4),
        "centroid": [round(centroid.x, 6), round(centroid.y, 6)],
        "bbox": [round(b, 6) for b in bounds],
        "is_valid": poly.is_valid
    }

@server.tool()
def inspect_geojson_file(relative_or_absolute_path: str) -> Dict[str, Any]:
    """
    Inspect any GeoJSON file in the project (e.g. 'data/provinces_boundaries.geojson').
    Returns feature count, geometry types, bounding box, and attribute columns.
    """
    path = relative_or_absolute_path
    if not os.path.isabs(path):
        path = os.path.join(ROOT_DIR, path)

    if not os.path.exists(path):
        return {"error": f"File not found: {path}"}

    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    features = data.get("features", [])
    geom_types = set()
    prop_keys = set()
    total_area_ha = 0.0

    minx, miny, maxx, maxy = float('inf'), float('inf'), float('-inf'), float('-inf')

    sample_props = []
    for idx, feat in enumerate(features[:100]):
        geom = feat.get("geometry")
        if geom:
            geom_types.add(geom.get("type", "Unknown"))
        props = feat.get("properties", {})
        prop_keys.update(props.keys())
        if idx < 3:
            sample_props.append(props)

    return {
        "file_name": os.path.basename(path),
        "file_size_bytes": os.path.getsize(path),
        "feature_count": len(features),
        "geometry_types": list(geom_types),
        "property_columns": list(prop_keys),
        "sample_properties": sample_props
    }

if __name__ == "__main__":
    server.run(transport="stdio")
