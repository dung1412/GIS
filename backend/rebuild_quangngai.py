"""
Rebuilds layer_098e5fdc SQLite database directly from the native Quangngai_rungkk.TAB file.
Uses native Transverse Mercator (lon_0=108, k=0.9999, x_0=500000) -> WGS84 without artificial Helmert shift.
Preserves authentic forestry classification: ldlr_t, sldlr_t, malr3, churung, dientich, xa, huyen.
"""

import os
import sys
import time
import json
import sqlite3

# Set GDAL/PROJ env before importing osgeo
os.environ["PROJ_DATA"] = r"C:\Program Files\QGIS 3.44.11\share\proj"
os.environ["PROJ_LIB"] = r"C:\Program Files\QGIS 3.44.11\share\proj"
os.environ["GDAL_DATA"] = r"C:\Program Files\QGIS 3.44.11\apps\gdal\share\gdal"

from osgeo import ogr, osr

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend"))
from shp_importer import decode_vietnamese_font

tab_path = r"d:\Du an\data\source_tab\Quangngai_rungkk.TAB"
main_sqlite = r"d:\Du an\data\layers\layer_098e5fdc.sqlite"
tmp_sqlite = r"d:\Du an\data\layers\layer_098e5fdc_rebuild_tmp.sqlite"

if os.path.exists(tmp_sqlite):
    try:
        os.remove(tmp_sqlite)
    except Exception:
        pass

con = sqlite3.connect(tmp_sqlite)
cur = con.cursor()
cur.execute("PRAGMA synchronous = OFF")
cur.execute("PRAGMA journal_mode = MEMORY")

cur.execute("""
    CREATE TABLE features (
        id TEXT PRIMARY KEY,
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

# Open TAB file with UTF-8 encoding so TCVN3 bytes (0x80-0xFF) pass through
# as Latin-1 codepoints that decode_vietnamese_font can then map to Unicode.
ogr.RegisterAll()
ds = ogr.Open(tab_path)
if not ds:
    # Try with explicit ENCODING open option for MapInfo driver
    ds = gdal_open_with_encoding(tab_path)
    if not ds:
        print(f"Error opening {tab_path}")
        sys.exit(1)

lyr = ds.GetLayer(0)
srs_tab = lyr.GetSpatialRef()

srs_wgs84 = osr.SpatialReference()
srs_wgs84.ImportFromEPSG(4326)
srs_wgs84.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
tx = osr.CoordinateTransformation(srs_tab, srs_wgs84)

batch_features = []
batch_rtree = []
rowid = 1
t0 = time.time()

category_colors = {
    "Rừng tự nhiên": "#1b4332",
    "Rừng trồng": "#22c55e",
    "Đất chưa có rừng": "#eab308",
    "Đất nông nghiệp": "#ca8a04",
    "Đất khác / Mặt nước": "#94a3b8"
}

for feat in lyr:
    geom = feat.GetGeometryRef()
    if not geom or geom.IsEmpty():
        continue

    g = geom.Clone()
    g.Transform(tx)
    minx, maxx, miny, maxy = g.GetEnvelope()

    ldlr = str(feat.GetField("ldlr_t") or "").strip().upper()
    sldlr = str(decode_vietnamese_font(feat.GetField("sldlr_t") or "")).strip()
    malr3 = float(feat.GetField("malr3") or 0.0)
    raw_id = feat.GetField("ID")
    plot_id = f"PLT-{rowid:06d}"

    # Determine forest classification category
    if ldlr in ["TXN", "TXP", "TXB", "TXG", "TXK", "TXD"]:
        category = "Rừng tự nhiên"
    elif ldlr in ["RTG", "RTC", "RTTN", "RTCD", "RTK"]:
        category = "Rừng trồng"
    elif ldlr in ["DTR", "DT1", "DT2", "DT3"]:
        category = "Đất chưa có rừng"
    elif ldlr in ["NN"]:
        category = "Đất nông nghiệp"
    else:
        category = "Đất khác / Mặt nước"

    area_ha = float(feat.GetField("dientich") or 0.0)
    if area_ha <= 0:
        area_ha = round((maxx - minx) * (maxy - miny) * 111320 * 110574 / 10000, 2)

    namtr = str(feat.GetField("namtr") or "").strip()
    year = int(namtr) if namtr.isdigit() and len(namtr) == 4 else 2022

    owner = str(decode_vietnamese_font(feat.GetField("churung") or "")).strip() or "Chưa rõ chủ rừng"
    huyen = str(decode_vietnamese_font(feat.GetField("huyen") or "")).strip() or "Chưa rõ huyện"
    xa = str(decode_vietnamese_font(feat.GetField("xa") or "")).strip() or "Chưa rõ xã"
    tk = str(feat.GetField("tk") or "-").strip()
    khoanh = str(feat.GetField("khoanh") or "-").strip()
    lo = str(feat.GetField("lo") or "-").strip()

    # GeoJSON geometry
    geom_json = g.ExportToJson()

    props = {
        "id": plot_id,
        "province": "Quảng Ngãi",
        "province_code": "QNG",
        "district": huyen,
        "commune": xa,
        "owner_name": owner,
        "sub_compartment": tk,
        "compartment": khoanh,
        "lot": lo,
        "area_ha": round(area_ha, 2),
        "area_m2": round(area_ha * 10000, 1),
        "ldlr_t": ldlr,
        "sldlr_t": sldlr,
        "tree_species": sldlr if sldlr else (ldlr if ldlr else "Chưa xác định"),
        "forest_category": category,
        "color": category_colors[category],
        "planting_year": year,
        "malr3": malr3,
        "layer_id": "layer_098e5fdc",
        "layer_name": "Bản đồ Quy hoạch LN tỉnh Quảng Ngãi 16.02.2025",
        "source_type": "Quy hoạch lâm nghiệp"
    }

    batch_features.append((plot_id, json.dumps(props, ensure_ascii=False), geom_json))
    batch_rtree.append((rowid, minx, maxx, miny, maxy))
    rowid += 1

    if len(batch_features) >= 10000:
        cur.executemany("INSERT INTO features (id, props, geom) VALUES (?, ?, ?)", batch_features)
        cur.executemany("INSERT INTO rtree_idx (fid, minx, maxx, miny, maxy) VALUES (?, ?, ?, ?, ?)", batch_rtree)
        con.commit()
        batch_features = []
        batch_rtree = []
        print(f"Committed {rowid-1} features ({(rowid-1)/(time.time()-t0):.0f} feat/s)...")

if batch_features:
    cur.executemany("INSERT INTO features (id, props, geom) VALUES (?, ?, ?)", batch_features)
    cur.executemany("INSERT INTO rtree_idx (fid, minx, maxx, miny, maxy) VALUES (?, ?, ?, ?, ?)", batch_rtree)
    con.commit()

# Add fast indexes
cur.execute("CREATE INDEX IF NOT EXISTS idx_features_id ON features(id)")
cur.execute("CREATE INDEX IF NOT EXISTS idx_features_district ON features(json_extract(props, '$.district'))")
cur.execute("CREATE INDEX IF NOT EXISTS idx_features_commune ON features(json_extract(props, '$.commune'))")
cur.execute("CREATE INDEX IF NOT EXISTS idx_features_owner ON features(json_extract(props, '$.owner_name'))")
cur.execute("CREATE INDEX IF NOT EXISTS idx_features_category ON features(json_extract(props, '$.forest_category'))")
con.commit()
con.close()

dt = time.time() - t0
total = rowid - 1
print(f"Done! Rebuilt {total} features in {dt:.1f}s.")

# Backup old sqlite and replace with rebuilt one
import shutil
if os.path.exists(main_sqlite):
    backup = main_sqlite.replace('.sqlite', '_backup.sqlite')
    shutil.copy2(main_sqlite, backup)
    print(f"Backed up old DB to: {backup}")
    os.replace(tmp_sqlite, main_sqlite)
else:
    os.rename(tmp_sqlite, main_sqlite)
print(f"Replaced {main_sqlite} with rebuilt database ({total} features, correct Unicode font).")
print("Restart the web server to apply changes.")
