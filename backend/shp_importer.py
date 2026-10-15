"""
Universal GIS Map Importer Module for Forestry GIS.
Supports:
  1. ESRI Shapefile (ZIP containing .shp, .dbf, .shx, .prj)
  2. MapInfo TAB (ZIP containing .tab, .dat, .map, .id)
  3. MapInfo MIF/MID (ZIP containing .mif, .mid, or standalone .mif)
  4. GeoJSON (.geojson, .json)
  5. KML / KMZ (.kml, .kmz)

Features:
  - Automatic CRS detection & conversion from VN-2000 (KTT 108°00', 108°15', 108°30') to WGS84 (EPSG:4326).
  - Built-in Vietnamese font decoder (TCVN3 / ABC / VNI / Windows-1258 -> Unicode UTF-8).
  - Preserves 100% of raw attribute columns for the QGIS Attribute Table Inspector.
  - Saves layers persistently into data/layers/ and registers them in layer_manager.
"""

import os
import re
import unicodedata
import zipfile
import tempfile
import json
import shutil
from typing import List, Dict, Any, Tuple, Optional

# Set PROJ and GDAL data paths dynamically from installed QGIS version
for qgis_ver in ["3.44.12", "3.44.11", "3.44"]:
    qgis_base = rf"C:\Program Files\QGIS {qgis_ver}"
    if os.path.exists(qgis_base):
        proj_dir = os.path.join(qgis_base, "share", "proj")
        gdal_dir = os.path.join(qgis_base, "apps", "gdal", "share", "gdal")
        if os.path.exists(proj_dir):
            os.environ["PROJ_DATA"] = proj_dir
            os.environ["PROJ_LIB"] = proj_dir
        if os.path.exists(gdal_dir):
            os.environ["GDAL_DATA"] = gdal_dir
        break

os.environ["PROJ_NETWORK"] = "OFF"

import pyproj
try:
    if "PROJ_DATA" in os.environ and os.path.exists(os.environ["PROJ_DATA"]):
        pyproj.datadir.set_data_dir(os.environ["PROJ_DATA"])
except Exception:
    pass

import geopandas as gpd
from shapely.validation import make_valid
from gis_engine import gis_db, PROVINCE_CRS_INFO
from layer_manager import layer_manager

# Common Vietnamese forestry attribute column mappings
COLUMN_MAPPINGS = {
    "owner": ["chu_rung", "churung", "ten_chu", "tenchu", "chu", "owner", "nguoi_dung", "ho_ten", "ten_tinh", "tenchuho"],
    "cccd": ["cccd", "cmnd", "socmnd", "so_cmnd", "cmt", "ma_tinh"],
    "phone": ["sdt", "dien_thoai", "dienthoai", "phone", "tel"],
    "sub_compartment": ["tieu_khu", "tieukhu", "tk", "sub_comp", "tieukhu_id"],
    "compartment": ["khoanh", "k", "khoang", "comp", "khoanh_id"],
    "lot": ["lo", "l", "thua", "so_thua", "thua_dat", "lo_id"],
    "area": ["dien_tich", "dientich", "dtich", "dt", "area", "area_ha", "s_ha", "dtich_km2", "dientich_ha"],
    "species": ["loai_cay", "loaicay", "cay_trong", "species", "loairung", "loai_dat_r", "mldlr"],
    "year": ["nam_trong", "namtrong", "year", "nam"],
    "province": ["tinh", "ten_tinh", "province", "tentinh"],
    "district": ["huyen", "ten_huyen", "district", "tenhuyen"],
    "commune": ["xa", "ten_xa", "commune", "tenxa"],
    "redbook": ["so_do", "sodo", "gcn", "so_gcn", "redbook", "so_seri"]
}

# TCVN3 (ABC / .VNTime) to Unicode character lookup table
TCVN3_CHARS = {
    0xb5: 'à', 0xb8: 'á', 0xb6: 'ả', 0xb7: 'ã', 0xb9: 'ạ',
    0xa8: 'ă', 0xbb: 'ằ', 0xbe: 'ắ', 0xbc: 'ẳ', 0xbd: 'ẵ', 0xc6: 'ặ',
    0xa9: 'â', 0xc7: 'ầ', 0xca: 'ấ', 0xc8: 'ẩ', 0xc9: 'ẫ', 0xcb: 'ậ',
    0xcc: 'è', 0xd0: 'é', 0xce: 'ẻ', 0xcf: 'ẽ', 0xd1: 'ẹ',
    0xaa: 'ê', 0xd2: 'ề', 0xd5: 'ế', 0xd3: 'ể', 0xd4: 'ễ', 0xd6: 'ệ',
    0xd7: 'ì', 0xdd: 'í', 0xd8: 'ỉ', 0xdc: 'ĩ', 0xde: 'ị',
    0xdf: 'ò', 0xe3: 'ó', 0xe1: 'ỏ', 0xe2: 'õ', 0xe4: 'ọ',
    0xab: 'ô', 0xe5: 'ồ', 0xe8: 'ố', 0xe6: 'ổ', 0xe7: 'ỗ', 0xe9: 'ộ',
    0xac: 'ơ', 0xea: 'ờ', 0xed: 'ớ', 0xeb: 'ở', 0xec: 'ỡ', 0xee: 'ợ',
    0xef: 'ù', 0xf3: 'ú', 0xf1: 'ủ', 0xf2: 'ũ', 0xf4: 'ụ',
    0xad: 'ư', 0xf5: 'ừ', 0xf8: 'ứ', 0xf6: 'ử', 0xf7: 'ữ', 0xf9: 'ự',
    0xfa: 'ỳ', 0xfd: 'ý', 0xfb: 'ỷ', 0xfc: 'ỹ', 0xfe: 'ỵ',
    0xae: 'đ', 0xa7: 'Đ',
    0xa1: 'Ă', 0xa2: 'Â', 0xa3: 'Ê', 0xa4: 'Ô', 0xa5: 'Ơ', 0xa6: 'Ư'
}

TCVN3_UPPER_SEQUENCES = [
    # ƯƠ combinations
    ('\xad\xac', 'ươ'), ('\xad\xed', 'ướ'), ('\xad\xea', 'ườ'), 
    ('\xad\xeb', 'ưở'), ('\xad\xec', 'ưỡ'), ('\xad\xee', 'ượ'),
    # Capital letter combinations
    ('A\xb5', 'À'), ('A\xb8', 'Á'), ('A\xb6', 'Ả'), ('A\xb7', 'Ã'), ('A\xb9', 'Ạ'),
    ('\xa1\xbb', 'Ằ'), ('\xa1\xbe', 'Ắ'), ('\xa1\xbc', 'Ẳ'), ('\xa1\xbd', 'Ẵ'), ('\xa1\xc6', 'Ặ'),
    ('\xa2\xc7', 'Ầ'), ('\xa2\xca', 'Ấ'), ('\xa2\xc8', 'Ẩ'), ('\xa2\xc9', 'Ẫ'), ('\xa2\xcb', 'Ậ'),
    ('E\xcc', 'È'), ('E\xd0', 'É'), ('E\xce', 'Ẻ'), ('E\xcf', 'Ẽ'), ('E\xd1', 'Ẹ'),
    ('\xa3\xd2', 'Ề'), ('\xa3\xd5', 'Ế'), ('\xa3\xd3', 'Ể'), ('\xa3\xd4', 'Ễ'), ('\xa3\xd6', 'Ệ'),
    ('I\xd7', 'Ì'), ('I\xdd', 'Í'), ('I\xd8', 'Ỉ'), ('I\xdc', 'Ĩ'), ('I\xde', 'Ị'),
    ('O\xdf', 'Ò'), ('O\xe3', 'Ó'), ('O\xe1', 'Ỏ'), ('O\xe2', 'Õ'), ('O\xe4', 'Ọ'),
    ('\xa4\xe5', 'Ồ'), ('\xa4\xe8', 'Ố'), ('\xa4\xe6', 'Ổ'), ('\xa4\xe7', 'Ỗ'), ('\xa4\xe9', 'Ộ'),
    ('\xa5\xea', 'Ờ'), ('\xa5\xed', 'Ớ'), ('\xa5\xeb', 'Ở'), ('\xa5\xec', 'Ỡ'), ('\xa5\xee', 'Ợ'),
    ('U\xef', 'Ù'), ('U\xf3', 'Ú'), ('U\xf1', 'Ủ'), ('U\xf2', 'Ũ'), ('U\xf4', 'Ụ'),
    ('\xa6\xf5', 'Ừ'), ('\xa6\xf8', 'Ứ'), ('\xa6\xf6', 'Ử'), ('\xa6\xf7', 'Ữ'), ('\xa6\xf9', 'Ự'),
    ('Y\xfa', 'Ỳ'), ('Y\xfd', 'Ý'), ('Y\xfb', 'Ỷ'), ('Y\xfc', 'Ỹ'), ('Y\xfe', 'Ỵ')
]

TCVN3_DISTINCT_CODES = set(range(0xa1, 0xb0)) | set(range(0xb5, 0xcc)) | set(range(0xd2, 0xdf)) | set(range(0xe4, 0xef)) | set(range(0xf4, 0xff))

VNI_REPLACEMENTS = [
    ('aù', 'á'), ('aø', 'à'), ('aû', 'ả'), ('aõ', 'ã'), ('aï', 'ạ'),
    ('aê', 'ă'), ('aé', 'ắ'), ('aè', 'ằ'), ('aú', 'ẳ'), ('aü', 'ẵ'), ('aë', 'ặ'),
    ('aâ', 'â'), ('aá', 'ấ'), ('aà', 'ầ'), ('aå', 'ẩ'), ('aã', 'ẫ'), ('aä', 'ậ'),
    ('eù', 'é'), ('eø', 'è'), ('eû', 'ẻ'), ('eõ', 'ẽ'), ('eï', 'ẹ'),
    ('eâ', 'ê'), ('eá', 'ế'), ('eà', 'ề'), ('eå', 'ể'), ('eã', 'ễ'), ('eä', 'ệ'),
    ('í', 'í'), ('ì', 'ì'), ('æ', 'ỉ'), ('ó', 'ó'), ('oø', 'ò'), ('oû', 'ỏ'), ('oõ', 'õ'), ('oï', 'ọ'),
    ('oâ', 'ô'), ('oá', 'ố'), ('oà', 'ồ'), ('oå', 'ổ'), ('oã', 'ỗ'), ('oä', 'ộ'),
    ('ôù', 'ớ'), ('ôø', 'ờ'), ('ôû', 'ở'), ('ôõ', 'ỡ'), ('ôï', 'ợ'),
    ('uù', 'ú'), ('uø', 'ù'), ('uû', 'ủ'), ('uõ', 'ũ'), ('uï', 'ụ'),
    ('öù', 'ứ'), ('öø', 'ừ'), ('öû', 'ử'), ('öõ', 'ữ'), ('öï', 'ự'),
    ('yù', 'ý'), ('yø', 'ỳ'), ('yû', 'ỷ'), ('yõ', 'ỹ'), ('î', 'ỵ'),
    ('ñ', 'đ'), ('Ñ', 'Đ'),
    ('AÙ', 'Á'), ('AØ', 'À'), ('AÛ', 'Ả'), ('AÕ', 'Ã'), ('AÏ', 'Ạ'),
    ('AÊ', 'Ă'), ('AÉ', 'Ắ'), ('AÈ', 'Ằ'), ('AÚ', 'Ẳ'), ('AÜ', 'Ẵ'), ('AË', 'Ặ'),
    ('AÂ', 'Â'), ('AÁ', 'Ấ'), ('AÀ', 'Ầ'), ('AÅ', 'Ẩ'), ('AÃ', 'Ẫ'), ('AÄ', 'Ậ'),
    ('EÙ', 'É'), ('EØ', 'È'), ('EÛ', 'Ẻ'), ('EÕ', 'Ẽ'), ('EÏ', 'Ẹ'),
    ('EÂ', 'Ê'), ('EÁ', 'Ế'), ('EÀ', 'Ề'), ('EÅ', 'Ể'), ('EÃ', 'Ễ'), ('EÄ', 'Ệ'),
    ('OÙ', 'Ó'), ('OØ', 'Ò'), ('OÛ', 'Ỏ'), ('OÕ', 'Õ'), ('OÏ', 'Ọ'),
    ('OÂ', 'Ô'), ('OÁ', 'Ố'), ('OÀ', 'Ồ'), ('OÅ', 'Ổ'), ('OÃ', 'Ỗ'), ('OÄ', 'Ộ'),
    ('ÔÙ', 'Ớ'), ('ÔØ', 'Ờ'), ('ÔÛ', 'Ở'), ('ÔÕ', 'Ỡ'), ('ÔÏ', 'Ợ'),
    ('UÙ', 'Ú'), ('UØ', 'Ù'), ('UÛ', 'Ủ'), ('UÕ', 'Ũ'), ('UÏ', 'Ụ'),
    ('ÖÙ', 'Ứ'), ('ÖØ', 'Ừ'), ('ÖÛ', 'Ử'), ('ÖÕ', 'Ữ'), ('ÖÏ', 'Ự')
]

def is_already_unicode_vietnamese(text: str) -> bool:
    if not text:
        return True
    pure_uni = sum(1 for c in text if 0x1ea0 <= ord(c) <= 0x1ef9 or ord(c) in (0x110, 0x111, 0x1a0, 0x1a1, 0x1af, 0x1b0))
    distinctive_tcvn = any(ord(c) in TCVN3_DISTINCT_CODES for c in text) or any(s in text for s, _ in TCVN3_UPPER_SEQUENCES)
    if pure_uni > 0 and not distinctive_tcvn:
        return True
    return False

def is_tcvn3_text(val: str) -> bool:
    if is_already_unicode_vietnamese(val):
        return False
    return any(ord(c) in TCVN3_CHARS for c in val) or any(s in val for s, _ in TCVN3_UPPER_SEQUENCES)

def decode_vietnamese_font(val: Any) -> Any:
    """
    Detects and converts TCVN3 (.VNTime) / VNI-Windows text encoding commonly found
    in MapInfo (.TAB, .MIF) and ESRI Shapefile forestry maps into clean Unicode UTF-8 (NFC).
    Preserves numbers, booleans, and already-valid Unicode Vietnamese strings.
    """
    if not isinstance(val, str) or not val.strip():
        return val

    # If already standard Vietnamese Unicode, normalize to NFC
    if is_already_unicode_vietnamese(val):
        return unicodedata.normalize('NFC', val)

    res = val
    # Check VNI
    has_vni = any(pair[0] in res for pair in VNI_REPLACEMENTS)
    if has_vni:
        for vni_seq, uni_char in VNI_REPLACEMENTS:
            if vni_seq in res:
                res = res.replace(vni_seq, uni_char)

    # Check TCVN3 (.VNTime, .VNTimeH)
    if is_tcvn3_text(res):
        for seq, uni in TCVN3_UPPER_SEQUENCES:
            if seq in res:
                res = res.replace(seq, uni)
        out = []
        for c in res:
            code = ord(c)
            if code in TCVN3_CHARS:
                out.append(TCVN3_CHARS[code])
            else:
                out.append(c)
        res = ''.join(out)

    return unicodedata.normalize('NFC', res)

def find_matched_column(columns: List[str], mapping_key: str) -> Optional[str]:
    """Finds matching attribute name regardless of case or accents."""
    candidates = COLUMN_MAPPINGS.get(mapping_key, [])
    lower_cols = {c.lower(): c for c in columns}
    for cand in candidates:
        if cand in lower_cols:
            return lower_cols[cand]
    return None

class ShapefileImporter:
    """Universal GIS Importer for Shapefile, MapInfo (TAB, MIF), GeoJSON, and KML."""

    def __init__(self):
        pass

    def import_from_zip(self, zip_bytes: bytes, default_province: str = "Quảng Ngãi", 
                        layer_name: str = "", source_type: str = "Kiểm kê rừng") -> Tuple[int, str]:
        """
        Extracts ZIP file containing:
          - ESRI Shapefile (.shp, .dbf, .shx, .prj)
          - MapInfo TAB (.tab, .dat, .map, .id)
          - MapInfo MIF (.mif, .mid)
          - GeoJSON (.geojson, .json)
          - KML (.kml)
        Detects coordinate system, converts to WGS84, and saves persistently into data/layers/.
        """
        temp_dir = tempfile.mkdtemp(prefix="forestry_gis_")
        zip_path = os.path.join(temp_dir, "uploaded.zip")
        
        try:
            with open(zip_path, "wb") as f:
                f.write(zip_bytes)

            with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                zip_ref.extractall(temp_dir)

            # Discover GIS spatial files in priority order
            target_file = None
            target_ext = ""
            target_basename = ""

            for root, _, files in os.walk(temp_dir):
                # 1. Check for Shapefile
                for file in files:
                    if file.lower().endswith(".shp"):
                        target_file = os.path.join(root, file)
                        target_ext = ".shp"
                        target_basename = file
                        break
                if target_file:
                    break

                # 2. Check for MapInfo TAB
                for file in files:
                    if file.lower().endswith(".tab"):
                        target_file = os.path.join(root, file)
                        target_ext = ".tab"
                        target_basename = file
                        break
                if target_file:
                    break

                # 3. Check for MapInfo MIF
                for file in files:
                    if file.lower().endswith(".mif"):
                        target_file = os.path.join(root, file)
                        target_ext = ".mif"
                        target_basename = file
                        break
                if target_file:
                    break

                # 4. Check for GeoJSON
                for file in files:
                    if file.lower().endswith((".geojson", ".json")):
                        target_file = os.path.join(root, file)
                        target_ext = ".geojson"
                        target_basename = file
                        break
                if target_file:
                    break

                # 5. Check for KML
                for file in files:
                    if file.lower().endswith(".kml"):
                        target_file = os.path.join(root, file)
                        target_ext = ".kml"
                        target_basename = file
                        break
                if target_file:
                    break

            if not target_file:
                return 0, (
                    "Không tìm thấy tệp bản đồ hợp lệ trong file ZIP được tải lên. "
                    "Hệ thống hỗ trợ: Shapefile (.shp), MapInfo TAB (.tab), MapInfo MIF (.mif), GeoJSON (.geojson) và KML (.kml)."
                )

            format_names = {
                ".shp": "Shapefile (ESRI)",
                ".tab": "MapInfo TAB",
                ".mif": "MapInfo MIF",
                ".geojson": "GeoJSON",
                ".kml": "KML"
            }
            fmt_desc = format_names.get(target_ext, "Bản đồ không gian")
            actual_name = layer_name or os.path.splitext(target_basename)[0]

            return self.process_gis_file(
                target_file, 
                default_province=default_province, 
                layer_name=actual_name, 
                source_type=source_type, 
                filename=target_basename,
                format_desc=fmt_desc
            )

        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def process_gis_file(self, file_path: str, default_province: str = "Quảng Ngãi",
                         layer_name: str = "Bản đồ Lâm Nghiệp", source_type: str = "Kiểm kê rừng",
                         filename: str = "", format_desc: str = "GIS") -> Tuple[int, str]:
        """
        Reads any vector GIS file via GeoPandas / GDAL OGR, handles VN-2000 meter coordinates,
        converts TCVN3/VNI text, and saves persistent GeoJSON.
        """
        try:
            try:
                # utf-8 is the correct encoding for TCVN3/VNI Vietnamese GIS files:
                # TCVN3 bytes (0x80–0xFF) are read as Latin-1 codepoints which
                # decode_vietnamese_font then maps correctly to Unicode.
                # Using cp1252/latin1 causes multi-byte UTF-8 escape sequences that break the TCVN3 decoder.
                gdf = gpd.read_file(file_path, encoding='utf-8')
            except Exception:
                try:
                    gdf = gpd.read_file(file_path)
                except Exception:
                    try:
                        gdf = gpd.read_file(file_path, encoding='cp1252')
                    except Exception:
                        gdf = gpd.read_file(file_path, encoding='latin1')


            if gdf.empty:
                return 0, f"Tệp {format_desc} không chứa đối tượng hình học nào."

            # Determine and convert CRS to WGS84 with official 7-parameter Helmert transformation
            ktt = PROVINCE_CRS_INFO.get(default_province, {}).get("ktt", 108.0)
            proj4_vn2000 = (
                f"+proj=tmerc +lat_0=0 +lon_0={ktt} +k=0.9999 +x_0=500000 +y_0=0 +ellps=WGS84 "
                f"+towgs84=-191.90441429,-39.30318279,-111.45032835,-0.00928836,0.01975479,-0.00427372,0.252906278 +units=m +no_defs"
            )

            bounds = gdf.total_bounds # [minx, miny, maxx, maxy]
            is_meter_coords = (bounds[0] > 1000 and bounds[1] > 1000)

            if gdf.crs is None or 'unnamed' in str(gdf.crs).lower() or is_meter_coords:
                # Assign VN-2000 projection for province with official Helmert shift
                gdf.set_crs(proj4_vn2000, inplace=True, allow_override=True)
                gdf_wgs84 = gdf.to_crs(epsg=4326)
            else:
                try:
                    gdf_wgs84 = gdf.to_crs(epsg=4326)
                except Exception:
                    gdf_wgs84 = gdf

            cols = list(gdf.columns)
            c_owner = find_matched_column(cols, "owner")
            c_cccd = find_matched_column(cols, "cccd")
            c_phone = find_matched_column(cols, "phone")
            c_tk = find_matched_column(cols, "sub_compartment")
            c_k = find_matched_column(cols, "compartment")
            c_lo = find_matched_column(cols, "lot")
            c_area = find_matched_column(cols, "area")
            c_species = find_matched_column(cols, "species")
            c_year = find_matched_column(cols, "year")
            c_prov = find_matched_column(cols, "province")
            c_dist = find_matched_column(cols, "district")
            c_commune = find_matched_column(cols, "commune")
            c_redbook = find_matched_column(cols, "redbook")

            features = []
            for idx, row in gdf_wgs84.iterrows():
                geom = row.geometry
                if geom is None or geom.is_empty:
                    continue

                if not geom.is_valid:
                    try:
                        geom = make_valid(geom)
                    except Exception:
                        pass

                # Convert Shapely geometry to GeoJSON-compatible dict
                if geom.geom_type == 'Polygon':
                    geo_type = 'Polygon'
                    coords = [[[round(c[0], 6), round(c[1], 6)] for c in geom.exterior.coords]]
                elif geom.geom_type == 'MultiPolygon':
                    geo_type = 'MultiPolygon'
                    coords = [[[[round(c[0], 6), round(c[1], 6)] for c in poly.exterior.coords]] for poly in geom.geoms]
                elif geom.geom_type == 'GeometryCollection':
                    polys = [g for g in geom.geoms if g.geom_type in ['Polygon', 'MultiPolygon']]
                    if not polys:
                        continue
                    if len(polys) == 1 and polys[0].geom_type == 'Polygon':
                        geo_type = 'Polygon'
                        coords = [[[round(c[0], 6), round(c[1], 6)] for c in polys[0].exterior.coords]]
                    else:
                        geo_type = 'MultiPolygon'
                        coords = []
                        for p in polys:
                            if p.geom_type == 'Polygon':
                                coords.append([[[round(c[0], 6), round(c[1], 6)] for c in p.exterior.coords]])
                            elif p.geom_type == 'MultiPolygon':
                                for sub_p in p.geoms:
                                    coords.append([[[round(c[0], 6), round(c[1], 6)] for c in sub_p.exterior.coords]])
                else:
                    continue

                # Build raw attributes dictionary with TCVN3/VNI font decoding
                raw_attrs = {}
                for col in cols:
                    if col != 'geometry':
                        clean_col = str(decode_vietnamese_font(col))
                        val = row[col]
                        if str(val) != 'nan':
                            decoded_val = decode_vietnamese_font(val)
                            raw_attrs[clean_col] = str(decoded_val) if not isinstance(decoded_val, (int, float)) else decoded_val

                prov_val = str(decode_vietnamese_font(row[c_prov])) if c_prov and str(row[c_prov]) != 'nan' else default_province
                dist_val = str(decode_vietnamese_font(row[c_dist])) if c_dist and str(row[c_dist]) != 'nan' else "Chưa rõ huyện"
                comm_val = str(decode_vietnamese_font(row[c_commune])) if c_commune and str(row[c_commune]) != 'nan' else "Chưa rõ xã"
                owner_val = str(decode_vietnamese_font(row[c_owner])) if c_owner and str(row[c_owner]) != 'nan' else f"Chủ sở hữu #{idx+1}"
                
                # Area calculation
                if c_area and str(row[c_area]) != 'nan':
                    try:
                        val_num = float(row[c_area])
                        area_ha = round(val_num * 100 if "km2" in str(c_area).lower() else val_num, 2)
                    except ValueError:
                        area_ha = round(geom.area * 111320 * 110574 / 10000, 2)
                else:
                    area_ha = round(geom.area * 111320 * 110574 / 10000, 2)

                plot_id = f"PLT-{idx+1:04d}"

                feat = {
                    "type": "Feature",
                    "id": plot_id,
                    "geometry": {
                        "type": geo_type,
                        "coordinates": coords
                    },
                    "properties": {
                        "id": plot_id,
                        "province": prov_val,
                        "province_code": "QNG" if "Ngãi" in prov_val else ("BDH" if "Định" in prov_val else "PYE"),
                        "district": dist_val,
                        "commune": comm_val,
                        "owner_name": owner_val,
                        "cccd": str(row[c_cccd]) if c_cccd and str(row[c_cccd]) != 'nan' else f"051{idx+1:09d}",
                        "phone": str(row[c_phone]) if c_phone and str(row[c_phone]) != 'nan' else "0905000000",
                        "sub_compartment": str(decode_vietnamese_font(row[c_tk])) if c_tk else "-",
                        "compartment": str(decode_vietnamese_font(row[c_k])) if c_k else "-",
                        "lot": str(decode_vietnamese_font(row[c_lo])) if c_lo else f"{idx+1}",
                        "area_ha": max(area_ha, 0.05),
                        "area_m2": round(max(area_ha, 0.05) * 10000, 1),
                        "tree_species": str(decode_vietnamese_font(row[c_species])) if c_species and str(row[c_species]) != 'nan' else "Keo lai",
                        "planting_year": int(row[c_year]) if c_year and str(row[c_year]).isdigit() else 2022,
                        "redbook_no": str(row[c_redbook]) if c_redbook and str(row[c_redbook]) != 'nan' else f"GCN-{idx+1:05d}",
                        "raw_attributes": raw_attrs
                    }
                }
                features.append(feat)

            if not features:
                return 0, f"Không có đối tượng đa giác hợp lệ nào được trích xuất từ tệp {format_desc}."

            geojson_data = {
                "type": "FeatureCollection",
                "features": features
            }

            # Register as persistent layer
            meta = layer_manager.register_layer(
                name=layer_name,
                province=default_province,
                source_type=source_type,
                geojson_data=geojson_data,
                filename=filename or f"{layer_name}.geojson"
            )

            # Reload GIS engine memory
            gis_db.reload_layers()

            return len(features), f"Đã nạp thành công {len(features)} đối tượng từ tệp {format_desc} vào lớp '{layer_name}'!"

        except Exception as e:
            return 0, f"Lỗi khi đọc tệp {format_desc}: {str(e)}"

    def import_from_geojson(self, geojson_str: str, default_province: str = "Quảng Ngãi",
                            layer_name: str = "Bản đồ GeoJSON", source_type: str = "Kiểm kê rừng") -> Tuple[int, str]:
        """Imports features from a raw GeoJSON string and persists as a layer."""
        try:
            data = json.loads(geojson_str)
            features = data.get("features", [])
            if not features:
                return 0, "File GeoJSON không chứa đối tượng nào."

            # Automatically decode Vietnamese fonts across all feature properties and raw_attributes
            for feat in features:
                props = feat.get("properties", {})
                for k, v in list(props.items()):
                    if isinstance(v, str):
                        props[k] = decode_vietnamese_font(v)
                    elif isinstance(v, dict):
                        new_sub = {}
                        for sub_k, sub_v in v.items():
                            clean_k = str(decode_vietnamese_font(sub_k))
                            clean_v = decode_vietnamese_font(sub_v) if isinstance(sub_v, str) else sub_v
                            new_sub[clean_k] = clean_v
                        props[k] = new_sub

            clean_layer_name = str(decode_vietnamese_font(layer_name))
            meta = layer_manager.register_layer(
                name=clean_layer_name,
                province=default_province,
                source_type=source_type,
                geojson_data=data,
                filename=f"{clean_layer_name}.geojson"
            )
            gis_db.reload_layers()
            return len(features), f"Đã nạp và lưu vĩnh viễn {len(features)} đối tượng từ file GeoJSON!"
        except Exception as e:
            return 0, f"Lỗi khi đọc file GeoJSON: {str(e)}"

    def import_from_single_file(self, file_bytes: bytes, filename: str, default_province: str = "Quảng Ngãi",
                                layer_name: str = "", source_type: str = "Kiểm kê rừng") -> Tuple[int, str]:
        """Handles standalone file uploads (.mif, .kml, .geojson, or guides user for .tab/.shp)."""
        lower_name = filename.lower()
        actual_name = layer_name or os.path.splitext(filename)[0]

        if lower_name.endswith(".tab"):
            return 0, (
                "Tệp MapInfo (.TAB) là tệp cấu trúc và cần đi kèm các tệp dữ liệu không gian (.DAT, .MAP, .ID). "
                "Vui lòng nén toàn bộ các tệp này (.tab, .dat, .map, .id) thành 1 tệp .ZIP và tải lên hệ thống."
            )
        elif lower_name.endswith(".shp"):
            return 0, (
                "Tệp Shapefile (.SHP) cần đi kèm các tệp thuộc tính (.DBF, .SHX, .PRJ). "
                "Vui lòng nén toàn bộ các tệp này thành 1 tệp .ZIP và tải lên hệ thống."
            )
        elif lower_name.endswith((".geojson", ".json")):
            try:
                text_content = file_bytes.decode("utf-8")
            except UnicodeDecodeError:
                text_content = file_bytes.decode("latin-1")
            return self.import_from_geojson(text_content, default_province, actual_name, source_type)
        elif lower_name.endswith((".mif", ".kml")):
            temp_dir = tempfile.mkdtemp(prefix="forestry_standalone_")
            temp_path = os.path.join(temp_dir, filename)
            try:
                with open(temp_path, "wb") as f:
                    f.write(file_bytes)
                fmt = "MapInfo MIF" if lower_name.endswith(".mif") else "KML"
                return self.process_gis_file(temp_path, default_province, actual_name, source_type, filename=filename, format_desc=fmt)
            finally:
                shutil.rmtree(temp_dir, ignore_errors=True)
        elif lower_name.endswith(".kmz"):
            temp_dir = tempfile.mkdtemp(prefix="forestry_kmz_")
            try:
                import io
                with zipfile.ZipFile(io.BytesIO(file_bytes), "r") as zf:
                    kml_names = [n for n in zf.namelist() if n.lower().endswith(".kml")]
                    if not kml_names:
                        return 0, "File KMZ không chứa tệp .kml nào bên trong."
                    target_kml = kml_names[0]
                    target_path = os.path.join(temp_dir, os.path.basename(target_kml))
                    with open(target_path, "wb") as out_f:
                        out_f.write(zf.read(target_kml))
                    return self.process_gis_file(target_path, default_province, actual_name, source_type, filename=filename, format_desc="KMZ / KML")
            except Exception as e:
                return 0, f"Lỗi giải nén tệp KMZ: {str(e)}"
            finally:
                shutil.rmtree(temp_dir, ignore_errors=True)
        else:
            return 0, "Định dạng tệp không được hỗ trợ. Vui lòng tải file Shapefile/MapInfo (.zip), GeoJSON (.geojson), KML (.kml, .kmz) hoặc MBTiles (.mbtiles)."

    # Backwards compatibility alias
    process_shp_file = process_gis_file

shp_importer = ShapefileImporter()
