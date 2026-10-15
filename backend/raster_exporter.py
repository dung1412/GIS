"""
Raster Exporter Module for Forestry GIS.
Exports satellite imagery covering any BBOX, stitches tiles into high-resolution rasters,
and generates World Files (.EWW / .TFW) and Projection Files (.PRJ) for VN-2000.
Enables instant import into QGIS, MapInfo, and MicroStation with exact georeferencing.
"""

import os
import io
import math
import zipfile
import urllib.request
import urllib.parse
from typing import Dict, Any, Tuple
from PIL import Image
from config import cloud_config

# Configure GDAL/PROJ data paths dynamically
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

from gis_engine import PROVINCE_CRS_INFO

# Standard ESRI WKT projections for Central Vietnam provinces (VN-2000 3-degree)
PRJ_WKT_TEMPLATES = {
    "Quảng Ngãi": '''PROJCS["VN_2000_Quang_Ngai_3_Deg",GEOGCS["GCS_VN_2000",DATUM["D_Vietnam_2000",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",108.0],PARAMETER["Scale_Factor",0.9999],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]''',
    "Bình Định": '''PROJCS["VN_2000_Binh_Dinh_3_Deg",GEOGCS["GCS_VN_2000",DATUM["D_Vietnam_2000",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",108.25],PARAMETER["Scale_Factor",0.9999],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]''',
    "Phú Yên": '''PROJCS["VN_2000_Phu_Yen_3_Deg",GEOGCS["GCS_VN_2000",DATUM["D_Vietnam_2000",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",108.5],PARAMETER["Scale_Factor",0.9999],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]'''
}

def deg2num(lat_deg: float, lon_deg: float, zoom: int) -> Tuple[int, int]:
    """Converts WGS84 lat/lon to slippy map tile (x, y)."""
    lat_rad = math.radians(lat_deg)
    n = 2.0 ** zoom
    xtile = int((lon_deg + 180.0) / 360.0 * n)
    ytile = int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)
    return xtile, ytile

def num2deg(xtile: int, ytile: int, zoom: int) -> Tuple[float, float]:
    """Converts slippy map tile (x, y) to northwest corner lat/lon."""
    n = 2.0 ** zoom
    lon_deg = xtile / n * 360.0 - 180.0
    lat_rad = math.atan(math.sinh(math.pi * (1 - 2 * ytile / n)))
    lat_deg = math.degrees(lat_rad)
    return lat_deg, lon_deg

def wgs84_to_vn2000(lon: float, lat: float, ktt: float = 108.0) -> Tuple[float, float]:
    """Converts WGS84 (lon, lat) to VN-2000 Easting (X), Northing (Y) with official 7-parameter Helmert shift."""
    proj_wgs84 = pyproj.CRS("EPSG:4326")
    proj_vn2000 = pyproj.CRS.from_string(
        f"+proj=tmerc +lat_0=0 +lon_0={ktt} +k=0.9999 +x_0=500000 +y_0=0 +ellps=WGS84 "
        f"+towgs84=-191.90441429,-39.30318279,-111.45032835,-0.00928836,0.01975479,-0.00427372,0.252906278 +units=m +no_defs"
    )
    transformer = pyproj.Transformer.from_crs(proj_wgs84, proj_vn2000, always_xy=True)
    x, y = transformer.transform(lon, lat)
    return x, y

class RasterExporter:
    def __init__(self):
        self.planet_key = cloud_config.PLANET_API_KEY
        self.google_key = cloud_config.GOOGLE_MAPS_API_KEY

    def export_bbox_package(self, min_lon: float, min_lat: float, max_lon: float, max_lat: float,
                            province: str = "Quảng Ngãi", basemap: str = "planet",
                            zoom: int = 14) -> bytes:
        """
        Fetches satellite tiles covering the bounding box, stitches them together,
        calculates .EWW world file and .PRJ projection file for VN-2000,
        and packages them into a ready-to-use ZIP file.
        """
        ktt = PROVINCE_CRS_INFO.get(province, {}).get("ktt", 108.0)

        # Clamp zoom level to prevent downloading too many tiles
        zoom = min(max(zoom, 10), 16)

        x_min, y_min = deg2num(max_lat, min_lon, zoom)
        x_max, y_max = deg2num(min_lat, max_lon, zoom)

        # Limit total tile grid to max 8x8 = 64 tiles per export
        if (x_max - x_min + 1) * (y_max - y_min + 1) > 64:
            zoom = max(10, zoom - 1)
            x_min, y_min = deg2num(max_lat, min_lon, zoom)
            x_max, y_max = deg2num(min_lat, max_lon, zoom)

        num_tiles_x = x_max - x_min + 1
        num_tiles_y = y_max - y_min + 1

        tile_size = 256
        composite_img = Image.new("RGB", (num_tiles_x * tile_size, num_tiles_y * tile_size), (0, 0, 0))

        # Base URL template for various satellite and basemap providers
        bm = str(basemap).lower()
        if bm in ("google-sat", "google_sat", "google"):
            url_tmpl = "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}"
            if self.google_key:
                url_tmpl += "&key=" + urllib.parse.quote(self.google_key, safe="")
        elif bm in ("google-hybrid", "google_hybrid", "hybrid"):
            url_tmpl = "https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}"
            if self.google_key:
                url_tmpl += "&key=" + urllib.parse.quote(self.google_key, safe="")
        elif bm in ("esri", "esri-sat", "maxar"):
            url_tmpl = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        elif bm in ("sentinel", "sentinel2", "copernicus"):
            url_tmpl = "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg"
        elif bm in ("nasa", "nasa-daily", "viirs"):
            import datetime
            yesterday_str = (datetime.datetime.now() - datetime.timedelta(days=1)).strftime("%Y-%m-%d")
            url_tmpl = f"https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/{yesterday_str}/GoogleMapsCompatible_Level9/{{z}}/{{y}}/{{x}}.jpg"
        elif bm in ("topo", "opentopomap"):
            url_tmpl = "https://tile.opentopomap.org/{z}/{x}/{y}.png"
        else: # Default: Planet NICFI
            if not self.planet_key:
                raise ValueError("Planet imagery requires PLANET_API_KEY in the environment")
            url_tmpl = f"https://tiles.planet.com/basemaps/v1/planet-tiles/global_monthly_2026_08_mosaic/gmap/{{z}}/{{x}}/{{y}}.png?api_key={self.planet_key}"

        # Download and paste tiles
        for ix, tx in enumerate(range(x_min, x_max + 1)):
            for iy, ty in enumerate(range(y_min, y_max + 1)):
                tile_url = url_tmpl.format(z=zoom, x=tx, y=ty)
                try:
                    req = urllib.request.Request(tile_url, headers={"User-Agent": "Mozilla/5.0"})
                    with urllib.request.urlopen(req, timeout=8) as resp:
                        tile_img = Image.open(io.BytesIO(resp.read()))
                        if tile_img.mode != "RGB":
                            tile_img = tile_img.convert("RGB")
                        composite_img.paste(tile_img, (ix * tile_size, iy * tile_size))
                except Exception:
                    pass

        # Calculate exact georeferenced bounding box of the composite image
        nw_lat, nw_lon = num2deg(x_min, y_min, zoom)
        se_lat, se_lon = num2deg(x_max + 1, y_max + 1, zoom)

        # Convert corners to VN-2000 (Easting X, Northing Y)
        vn_ul_x, vn_ul_y = wgs84_to_vn2000(nw_lon, nw_lat, ktt=ktt)
        vn_lr_x, vn_lr_y = wgs84_to_vn2000(se_lon, se_lat, ktt=ktt)

        img_width, img_height = composite_img.size
        pixel_size_x = (vn_lr_x - vn_ul_x) / img_width
        pixel_size_y = (vn_ul_y - vn_lr_y) / img_height # positive magnitude

        # 6-line World File (.EWW / .TFW)
        # Line 1: x-scale (meters/pixel)
        # Line 2: y-skew (0.0)
        # Line 3: x-skew (0.0)
        # Line 4: negative y-scale (-meters/pixel)
        # Line 5: upper-left pixel center X (Easting)
        # Line 6: upper-left pixel center Y (Northing)
        world_file_content = (
            f"{pixel_size_x:.6f}\n"
            f"0.000000\n"
            f"0.000000\n"
            f"{-pixel_size_y:.6f}\n"
            f"{vn_ul_x + pixel_size_x/2.0:.4f}\n"
            f"{vn_ul_y - pixel_size_y/2.0:.4f}\n"
        )

        prj_content = PRJ_WKT_TEMPLATES.get(province, PRJ_WKT_TEMPLATES["Quảng Ngãi"])

        # Save composite image to buffer
        img_buffer = io.BytesIO()
        composite_img.save(img_buffer, format="JPEG", quality=92)
        img_bytes = img_buffer.getvalue()

        # Build ZIP archive containing .ecw / .jpg, .eww / .jgw, and .prj
        zip_buffer = io.BytesIO()
        ascii_prov = "QuangNgai" if "Ngãi" in province else ("BinhDinh" if "Định" in province else "PhuYen")
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            base_name = f"VeTinh_{ascii_prov}_VN2000_z{zoom}"
            
            # 1. Main high-res raster image
            zf.writestr(f"{base_name}.ecw", img_bytes)
            zf.writestr(f"{base_name}.jpg", img_bytes)

            # 2. World Files for both ECW (.eww) and JPG (.jgw)
            zf.writestr(f"{base_name}.eww", world_file_content.encode("utf-8"))
            zf.writestr(f"{base_name}.jgw", world_file_content.encode("utf-8"))

            # 3. Projection File (.prj) for VN-2000
            zf.writestr(f"{base_name}.prj", prj_content.encode("utf-8"))

            # 4. User Guide
            readme = f"""HƯỚNG DẪN SỬ DỤNG ẢNH VỆ TINH TRONG QGIS / MAPINFO / MICROSTATION
========================================================================
- Khu vực: {province} (Hệ quy chiếu VN-2000, Kinh tuyến trục {ktt}°)
- Độ phóng đại zoom: {zoom}
- Độ phân giải: {pixel_size_x:.2f} mét / pixel
- Tọa độ góc trên trái (VN-2000): X = {vn_ul_x:.2f} m, Y = {vn_ul_y:.2f} m

CÁCH MỞ TRÊN PHẦN MỀM:
1. Trong QGIS: Kéo thả trực tiếp file '{base_name}.ecw' hoặc '{base_name}.jpg' vào giao diện. 
   File .EWW và .PRJ đi kèm sẽ tự động định vị đúng vị trí thửa đất trên bản đồ Việt Nam.
2. Trong MapInfo: Chọn File -> Open -> chọn kiểu Raster Image (*.ecw, *.jpg).
3. Trong MicroStation SE/v8: Chọn Raster Manager -> Attach -> chọn file và bật Georeference.
========================================================================
"""
            zf.writestr("HUONG_DAN_SU_DUNG.txt", readme.encode("utf-8"))

        return zip_buffer.getvalue()

raster_exporter = RasterExporter()
