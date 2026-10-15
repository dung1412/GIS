"""
FastAPI Server for Forestry GIS & Red Book Shape Matching Web Application.
Serves RESTful spatial APIs and Frontend Static Assets.
"""

import os
import sys
import base64
import urllib.request
from typing import Optional, List, Dict, Any, Union
from fastapi import FastAPI, UploadFile, File, Form, Query, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, FileResponse, Response
from pydantic import BaseModel

# Add current dir to sys.path
sys.path.insert(0, os.path.dirname(__file__))

from gis_engine import gis_db, PROVINCE_CRS_INFO
from shape_matcher import shape_matcher_engine
from redbook_vision_parser import document_parser
from redbook_ocr import redbook_helper, vn2000_to_wgs84
from eudr_compliance import eudr_engine
from shp_importer import shp_importer
from copernicus_engine import copernicus_engine
from layer_manager import layer_manager
from raster_exporter import raster_exporter
from redbook_manager import redbook_manager
from mbtiles_manager import mbtiles_manager
from document_font_converter import convert_docx, convert_xlsx
from auth_manager import auth_manager
from user_map_manager import user_map_manager

app = FastAPI(
    title="Central Vietnam Forestry GIS & Red Book Matcher",
    description="Hệ thống GIS quản lý chủ rừng, so khớp hình thể sổ đỏ và giám sát chứng chỉ FM/SBP",
    version="1.0.0"
)

# Enable CORS for local development and mobile field app testing
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Hosted installations protect source records and shared editing by default through
# WEBGIS_REQUIRE_AUTH=1. Public map fonts/boundaries remain accessible to MapLibre.
REQUIRE_AUTH = os.getenv("WEBGIS_REQUIRE_AUTH", "0") == "1"
ALLOW_REGISTRATION = os.getenv(
    "WEBGIS_ALLOW_REGISTRATION", "0" if REQUIRE_AUTH else "1"
) == "1"
PUBLIC_API_PATHS = {
    "/api/health", "/api/config", "/api/auth/login", "/api/auth/register",
    "/api/auth/logout", "/api/provinces/boundaries", "/api/copernicus/deeplink",
}
SHARED_WRITE_PATHS = (
    "/api/layers", "/api/map/import", "/api/redbooks", "/api/survey/submit",
    "/api/shape-match/upload",
)


@app.middleware("http")
async def protect_hosted_data(request, call_next):
    path = request.url.path.rstrip("/")
    public = path in PUBLIC_API_PATHS or path.startswith((
        "/api/fonts/", "/api/tiles/jrc-eudr/",
    ))
    if REQUIRE_AUTH and path.startswith("/api/") and not public and request.method != "OPTIONS":
        user = get_current_user_optional(request.headers.get("authorization"))
        if not user:
            return JSONResponse(
                status_code=401,
                content={"detail": "Vui lòng đăng nhập để truy cập dữ liệu"},
                headers={"WWW-Authenticate": "Bearer"},
            )
        shared_write = request.method not in {"GET", "HEAD", "OPTIONS"} and any(
            path == prefix or path.startswith(prefix + "/") for prefix in SHARED_WRITE_PATHS
        )
        if shared_write and user.get("role") != "admin":
            return JSONResponse(
                status_code=403,
                content={"detail": "Chỉ quản trị viên được sửa dữ liệu dùng chung"},
            )
    return await call_next(request)


# --- MODELS ---
class CoordinateParseRequest(BaseModel):
    coordinate_text: str
    province: str = "Quảng Ngãi"

class SurveySubmitRequest(BaseModel):
    plot_id: str
    surveyor_name: str
    survey_date: str
    gps_lat: float
    gps_lon: float
    gps_accuracy_m: float
    tree_height_m: float
    tree_diameter_cm: float
    crown_cover_pct: int
    fm_buffer_zone_ok: bool
    no_prohibited_chemicals: bool
    notes: Optional[str] = None
    watermark_photo_b64: Optional[str] = None

class LayerSaveFeaturesRequest(BaseModel):
    geojson_data: dict

class LayerLabelConfigRequest(BaseModel):
    label_config: dict

class RedBookNoteUpdateRequest(BaseModel):
    notes: str
    status: Optional[str] = None

class RedBookManualSaveRequest(BaseModel):
    owner_name: Optional[str] = "Chưa rõ chủ đất"
    sheet_no: Optional[str] = "-"
    parcel_no: Optional[str] = "-"
    province: Optional[str] = "Quảng Ngãi"
    area_m2: Optional[float] = 0.0
    matched_plot_id: Optional[str] = "Chưa ghép"
    similarity_percent: Optional[float] = 0.0
    status: Optional[str] = "Chưa tìm thấy vị trí"
    survey_notes: Optional[str] = ""

class UserRegisterRequest(BaseModel):
    username: str
    email: str
    password: str
    full_name: str
    department: Optional[str] = "Phòng Bền Vững"

class UserLoginRequest(BaseModel):
    username: str
    password: str

class CreateMapRequest(BaseModel):
    name: str
    description: Optional[str] = ""
    province: Optional[str] = "Quảng Ngãi"
    is_public: Optional[bool] = False

class UpdateMapRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    province: Optional[str] = None
    center_lon: Optional[float] = None
    center_lat: Optional[float] = None
    zoom_level: Optional[float] = None
    basemap: Optional[str] = None
    is_public: Optional[bool] = None

class CreateUserLayerRequest(BaseModel):
    name: str
    geojson_data: dict
    source_type: Optional[str] = "Bản đồ cá nhân"
    province: Optional[str] = "Quảng Ngãi"
    palette_color: Optional[str] = "#10b981"

# In-memory storage for field survey inspections
field_surveys = []

# --- API ROUTES ---

@app.get("/api/health")
def health_check():
    return {"status": "ok", "service": "Forestry GIS & Shape Matcher", "version": "1.0.0"}

@app.get("/api/config")
def get_public_config():
    """Expose configuration status without publishing API credentials."""
    from config import cloud_config
    return {
        "has_google_maps_key": bool(cloud_config.GOOGLE_MAPS_API_KEY),
        "requires_auth": REQUIRE_AUTH,
        "registration_enabled": ALLOW_REGISTRATION,
    }

@app.post("/api/redbook/ocr")
@app.post("/api/redbook/ocr-cloud-vision")
async def ocr_redbook(file: UploadFile = File(...)):
    """Runs Hybrid AI OCR (Google Cloud Vision with automatic RapidOCR offline fallback) on uploaded Red Book image."""
    contents = await file.read()
    return redbook_helper.ocr_image(contents)

@app.post("/api/font-convert/document")
async def convert_document_font(
    file: UploadFile = File(...),
    to_unicode: bool = Form(True)
):
    """Converts fonts in Word/Excel files between TCVN3 and Unicode."""
    contents = await file.read()
    filename = file.filename.lower()
    
    try:
        if filename.endswith(".docx"):
            out_bytes = convert_docx(contents, to_unicode)
            media_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            out_filename = f"converted_{file.filename}"
        elif filename.endswith(".xlsx"):
            out_bytes = convert_xlsx(contents, to_unicode)
            media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            out_filename = f"converted_{file.filename}"
        else:
            raise HTTPException(status_code=400, detail="Only .docx and .xlsx files are supported")
            
        return Response(
            content=out_bytes, 
            media_type=media_type,
            headers={"Content-Disposition": f'attachment; filename="{out_filename}"'}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/copernicus/deeplink")
def get_copernicus_deeplink(
    lat: float = Query(..., description="Vĩ độ"),
    lon: float = Query(..., description="Kinh độ"),
    mode: str = Query("eudr_2020", description="eudr_2020, ndvi, false_color, true_color")
):
    """Generates direct URL to Copernicus Browser focused on plot with specific date & layer."""
    url = copernicus_engine.generate_copernicus_browser_url(lat, lon, mode)
    return {"status": "success", "copernicus_browser_url": url, "mode": mode}

@app.get("/api/copernicus/status")
def get_copernicus_status():
    """Report connectivity without exposing account identifiers or tokens."""
    configured = bool(copernicus_engine.username and copernicus_engine.password)
    token = copernicus_engine.get_access_token() if configured else None
    return {
        "status": "connected" if token else "disconnected",
        "configured": configured,
        "has_active_token": bool(token),
    }

@app.get("/api/provinces")
def get_provinces():
    """Summary statistics for Quang Ngai, Binh Dinh, Phu Yen."""
    return gis_db.get_provinces_summary()

@app.get("/api/provinces/boundaries")
def get_province_boundaries():
    """Returns official administrative boundary GeoJSON for Quang Ngai, Binh Dinh, Phu Yen."""
    bpath = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "provinces_boundaries.geojson")
    if os.path.exists(bpath):
        with open(bpath, "r", encoding="utf-8") as f:
            return Response(content=f.read(), media_type="application/geo+json")
    raise HTTPException(status_code=404, detail="Boundaries file not found")

@app.get("/api/plots")
def get_plots(
    query: str = Query("", description="Tìm kiếm chủ rừng, CCCD, mã lô, số sổ đỏ"),
    province: str = Query("", description="Lọc theo Tỉnh (Quảng Ngãi, Bình Định, Phú Yên)"),
    district: str = Query("", description="Lọc theo Huyện"),
    limit: int = Query(50, ge=1, le=500),
    page: int = Query(1, ge=1)
):
    """Returns GeoJSON FeatureCollection of forest plots with total count across whole database."""
    plots, total_count = gis_db.search_plots(
        query=query,
        province=province,
        district=district,
        limit=limit,
        page=page
    )
    geojson = gis_db.to_geojson(plots)
    geojson["total_count"] = total_count
    geojson["page"] = page
    geojson["page_size"] = limit
    return geojson

@app.get("/api/plots/{plot_id}")
def get_plot_detail(plot_id: str):
    """Detailed information for a single forest plot."""
    plot = gis_db.get_plot_by_id(plot_id)
    if not plot:
        raise HTTPException(status_code=404, detail="Không tìm thấy lô rừng")
    
    compliance = eudr_engine.evaluate_plot_compliance(plot)
    surveys = [s for s in field_surveys if s["plot_id"] == plot_id]
    
    return {
        "plot": plot,
        "compliance": compliance,
        "surveys": surveys
    }

@app.post("/api/shape-match/upload")
async def match_uploaded_redbook(
    file: Optional[UploadFile] = File(None),
    files: Optional[List[UploadFile]] = File(None),
    owner_name: Optional[str] = Form(None),
    province: Optional[str] = Form("Quảng Ngãi"),
    district: Optional[str] = Form(None),
    commune: Optional[str] = Form(None),
    parcel_no: Optional[str] = Form(None),
    sheet_no: Optional[str] = Form(None),
    area_ha: Optional[float] = Form(None),
    roi_box: Optional[str] = Form(None)
):
    """
    Hierarchical Shape & Cadastral Matching Engine:
    Hỗ trợ nạp 1 hoặc nhiều ảnh (Mặt 1: Pháp lý & Mặt 2: Sơ đồ hình thể).
    Step 1: Tìm theo Chủ rừng (Owner Name)
    Step 2: Dò vị trí toàn Huyện (District wide search)
    Step 3: So khớp hình thể (Shape Similarity) trên các lô ứng viên
    """
    contour = None
    meta = {}
    effective_owner = owner_name
    effective_district = district
    effective_commune = commune
    effective_parcel = parcel_no
    effective_sheet = sheet_no
    effective_area = area_ha

    parsed_roi = None
    if roi_box:
        try:
            parsed_roi = json.loads(roi_box)
        except Exception:
            pass

    # Collect all uploaded files (single or multiple)
    all_uploads = []
    if files:
        for f in files:
            if f and f.filename and f not in all_uploads:
                all_uploads.append(f)
    if file and file.filename and not any(f.filename == file.filename for f in all_uploads):
        all_uploads.append(file)

    for up_file in all_uploads:
        try:
            contents = await up_file.read()
            if not contents:
                continue

            # 1. Trích xuất đường bao thửa đất & bảng kê
            cur_cnt, cur_meta = shape_matcher_engine.extract_contour_from_image_bytes(contents, roi_box=parsed_roi)
            if cur_cnt is not None:
                # Ưu tiên contour có số đỉnh và diện tích rõ ràng của sơ đồ thửa đất
                if contour is None or cur_meta.get("candidates_count", 0) > meta.get("candidates_count", 0):
                    contour = cur_cnt
                    for k, v in cur_meta.items():
                        if v:
                            meta[k] = v

            # 2. Sử dụng Gemini 3 Vision (DocumentParser) để đọc thông tin (thay thế OCR cũ)
            img, owner_img, sketch_img, prep_meta = document_parser.preprocess_image(contents)
            vision_res = document_parser.extract_parcel_data(owner_img, sketch_img)
            
            if "error" not in vision_res:
                pinfo = vision_res
                def get_val(key):
                    val = pinfo.get(key, {}).get("value")
                    return val if val != "-" else None

                meta["detected_owner"] = get_val("owner_name")
                meta["detected_district"] = get_val("district")
                meta["detected_commune"] = get_val("commune")
                meta["detected_parcel"] = get_val("parcel_no")
                meta["detected_sheet"] = get_val("sheet_no")
                meta["detected_land_purpose"] = get_val("land_use_purpose")
                
                area_m2 = get_val("area_m2")
                if area_m2 and str(area_m2).replace('.', '', 1).isdigit():
                    meta["detected_area_ha"] = float(area_m2) / 10000.0
                    meta["detected_area_m2"] = float(area_m2)

                meta["adjacent_neighbors"] = pinfo.get("adjacent_neighbors", [])
                meta["edge_lengths_meters"] = pinfo.get("edge_lengths_meters", [])
                
                # Cập nhật Contour chính xác từ tọa độ đỉnh do Gemini nhận diện
                ai_vertices = pinfo.get("parcel_shape_vertices", [])
                if isinstance(ai_vertices, list) and len(ai_vertices) >= 3:
                    try:
                        import numpy as np
                        pts = []
                        for v in ai_vertices:
                            pts.append([float(v.get("x", 0)), float(v.get("y", 0))])
                        pts_arr = np.array(pts, dtype=np.int32)
                        contour = pts_arr.reshape((-1, 1, 2))
                    except Exception as e:
                        print(f"Lỗi khi parse toạ độ đỉnh từ AI: {e}")
                        
                meta["ocr_engine"] = "Gemini 3.1 Pro (Vision)"
        except Exception as e:
            print(f"Error processing uploaded redbook image {up_file.filename}: {e}")

    # Đồng bộ tọa độ VN-2000 từ bảng kê nếu OCR trực tiếp chưa bắt được
    if not meta.get("detected_coordinates_points") and meta.get("table_text"):
        coords_from_table = redbook_helper.parse_coordinate_table_text(meta["table_text"])
        if coords_from_table:
            meta["detected_coordinates_points"] = coords_from_table

    # Tự động điền các thông tin phát hiện được từ OCR nếu người dùng chưa nhập tay
    if not effective_owner and meta.get("detected_owner"):
        effective_owner = meta["detected_owner"]
    if not effective_district and meta.get("detected_district"):
        effective_district = meta["detected_district"]
    if not effective_commune and meta.get("detected_commune"):
        effective_commune = meta["detected_commune"]
    if not effective_parcel and meta.get("detected_parcel") and meta.get("detected_parcel") != "-":
        effective_parcel = meta["detected_parcel"]
    if not effective_sheet and meta.get("detected_sheet") and meta.get("detected_sheet") != "-":
        effective_sheet = meta["detected_sheet"]
    if not effective_area and meta.get("detected_area_ha", 0) > 0:
        effective_area = meta["detected_area_ha"]

    # Execute hierarchical multi-tiered search on real loaded GIS layers (quét toàn huyện, top 10)
    real_matches = redbook_matcher.match_plots(
        owner_name=effective_owner,
        province=province or "Quảng Ngãi",
        district=effective_district,
        commune=effective_commune,
        parcel_no=effective_parcel,
        sheet_no=effective_sheet,
        area_ha=effective_area,
        input_contour=contour,
        limit=10
    )

    # Fallback to mock plots only if real layers returned nothing and contour exists
    if not real_matches and contour is not None:
        real_matches = redbook_manager.match_against_real_plots(
            input_contour=contour,
            province=province or "",
            plots_list=gis_db.plots
        )

    top_plot = real_matches[0] if real_matches else None
    
    # Auto-log to Red Book audit table
    log_entry = redbook_manager.save_record({
        "owner_name": effective_owner or (top_plot["owner_name"] if top_plot else "Chưa rõ chủ đất"),
        "sheet_no": effective_sheet or meta.get("detected_sheet", "-"),
        "parcel_no": effective_parcel or meta.get("detected_parcel", "-"),
        "province": province or (top_plot.get("province", "Quảng Ngãi") if top_plot else "Quảng Ngãi"),
        "district": effective_district or (top_plot.get("district", "-") if top_plot else "-"),
        "commune": effective_commune or (top_plot.get("commune", "-") if top_plot else "-"),
        "area_m2": meta.get("detected_area_m2") or (effective_area * 10000.0 if effective_area else (top_plot.get("area_m2", 0) if top_plot else 0.0)),
        "matched_plot_id": top_plot["plot_id"] if top_plot and top_plot.get("similarity_percent", 0) >= 60 else "Chưa ghép",
        "similarity_percent": top_plot.get("similarity_percent", 0.0) if top_plot else 0.0,
        "status": "Đã tìm thấy vị trí" if top_plot and top_plot.get("similarity_percent", 0) >= 60 else "Chưa tìm thấy vị trí",
        "survey_notes": " ; ".join(top_plot.get("reasons", [])) if top_plot else "Chưa tìm thấy thửa đất tương đồng trên các bản đồ đã nạp",
        "centroid": top_plot["centroid"] if top_plot else [108.5, 14.0]
    })

    return {
        "status": "success",
        "search_criteria": {
            "owner_name": effective_owner,
            "district": effective_district,
            "commune": effective_commune,
            "parcel_no": effective_parcel,
            "sheet_no": effective_sheet,
            "area_ha": effective_area
        },
        "contour_meta": meta,
        "matches_count": len(real_matches),
        "matches": real_matches,
        "audit_log_entry": log_entry
    }

@app.get("/api/shape-match/search")
def search_shape_match_plots(
    owner_name: Optional[str] = Query(None),
    province: Optional[str] = Query("Quảng Ngãi"),
    district: Optional[str] = Query(None),
    commune: Optional[str] = Query(None),
    parcel_no: Optional[str] = Query(None),
    sheet_no: Optional[str] = Query(None),
    area_ha: Optional[float] = Query(None)
):
    """Fast text/attribute search without uploading an image."""
    matches = redbook_matcher.match_plots(
        owner_name=owner_name,
        province=province or "Quảng Ngãi",
        district=district,
        commune=commune,
        parcel_no=parcel_no,
        sheet_no=sheet_no,
        area_ha=area_ha,
        input_contour=None,
        limit=20
    )
    return {
        "status": "success",
        "matches_count": len(matches),
        "matches": matches
    }

@app.post("/api/map/import")
async def import_map_file(
    file: UploadFile = File(...),
    province: Optional[str] = Form("Quảng Ngãi"),
    layer_name: Optional[str] = Form(None),
    source_type: Optional[str] = Form("Kiểm kê rừng"),
    map_id: Optional[str] = Form(None),
    authorization: Optional[str] = Header(None)
):
    """
    Imports Map data:
      - Shapefile (.ZIP containing .shp, .dbf, .shx, .prj)
      - MapInfo TAB (.ZIP containing .tab, .dat, .map, .id)
      - MapInfo MIF (.ZIP containing .mif, .mid or direct .mif)
      - GeoJSON (.geojson, .json)
      - KML / KMZ (.kml, .kmz)
      - MBTiles (.mbtiles offline raster/vector tile database)
    Automatically reprojects VN-2000 to WGS84 and saves permanently into data/layers/.
    If authenticated with map_id, also associates with the user's private map workspace.
    """
    contents = await file.read()
    filename = file.filename
    name_clean = layer_name or os.path.splitext(file.filename)[0]

    if filename.lower().endswith(".mbtiles"):
        ok, msg, layer_meta = mbtiles_manager.register_mbtiles(
            file_bytes=contents,
            filename=filename,
            default_province=province or "Quảng Ngãi",
            layer_name=name_clean,
            source_type=source_type or "MBTiles Ngoại tuyến"
        )
        if not ok:
            raise HTTPException(status_code=400, detail=msg)
        return {
            "status": "success",
            "imported_count": layer_meta.get("feature_count", 1),
            "message": msg,
            "total_system_plots": len(gis_db.plots),
            "layers": layer_manager.get_catalog(),
            "layer": layer_meta
        }

    if filename.lower().endswith(".zip"):
        count, msg = shp_importer.import_from_zip(
            contents, 
            default_province=province or "Quảng Ngãi",
            layer_name=name_clean,
            source_type=source_type or "Kiểm kê rừng"
        )
    else:
        count, msg = shp_importer.import_from_single_file(
            file_bytes=contents,
            filename=filename,
            default_province=province or "Quảng Ngãi",
            layer_name=name_clean,
            source_type=source_type or "Kiểm kê rừng"
        )

    if count == 0:
        raise HTTPException(status_code=400, detail=msg)

    # If user workspace is provided, associate newly created layer into user's map
    user = get_current_user_optional(authorization)
    if user and map_id:
        catalog = layer_manager.get_catalog()
        if catalog:
            latest_layer = catalog[-1]
            gj = layer_manager.get_layer_geojson(latest_layer["id"], prefer_overview=False)
            if gj:
                try:
                    user_map_manager.add_user_layer(
                        map_id=map_id,
                        user_id=user["id"],
                        name=latest_layer["name"],
                        geojson_data=gj,
                        source_type=latest_layer.get("source_type", "Lớp nhập cá nhân"),
                        province=latest_layer.get("province", province or "Quảng Ngãi"),
                        palette_color="#34d399"
                    )
                except Exception as e:
                    print("Could not auto-add layer to user map:", e)

    return {
        "status": "success",
        "imported_count": count,
        "message": msg,
        "total_system_plots": len(gis_db.plots),
        "layers": layer_manager.get_catalog()
    }

# --- LAYER MANAGEMENT APIS ---
@app.get("/api/layers")
def get_layers_catalog():
    """Returns metadata catalog of all persistent layers."""
    return layer_manager.get_catalog()

@app.get("/api/layers/{layer_id}/attributes")
def get_layer_attributes(
    layer_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    search: str = Query("")
):
    """Returns paginated attribute table of a layer (like QGIS Open Attribute Table)."""
    return layer_manager.get_attribute_table(layer_id, page=page, page_size=page_size, search=search)

@app.get("/api/layers/{layer_id}/features")
def get_layer_geojson_features(layer_id: str, full: bool = False):
    """Returns GeoJSON for a specific layer. Uses lightweight overview for large layers to ensure sub-50ms speed."""
    geojson = layer_manager.get_layer_geojson(layer_id, prefer_overview=(not full))
    if not geojson:
        raise HTTPException(status_code=404, detail="Không tìm thấy lớp bản đồ")
    return geojson

@app.get("/api/layers/{layer_id}/bbox")
def get_layer_bbox_features(
    layer_id: str,
    min_lon: Optional[float] = Query(None),
    min_lat: Optional[float] = Query(None),
    max_lon: Optional[float] = Query(None),
    max_lat: Optional[float] = Query(None),
    minx: Optional[float] = Query(None),
    miny: Optional[float] = Query(None),
    maxx: Optional[float] = Query(None),
    maxy: Optional[float] = Query(None),
    limit: int = Query(5000, ge=1, le=25000)
):
    """Executes high-speed (<2ms) spatial bounding box query via SQLite R-Tree."""
    _minx = min_lon if min_lon is not None else minx
    _miny = min_lat if min_lat is not None else miny
    _maxx = max_lon if max_lon is not None else maxx
    _maxy = max_lat if max_lat is not None else maxy
    if _minx is None or _miny is None or _maxx is None or _maxy is None:
        raise HTTPException(status_code=400, detail="Thiếu tọa độ BBOX (min_lon/minx, min_lat/miny, max_lon/maxx, max_lat/maxy)")
    geojson = layer_manager.get_layer_bbox(layer_id, _minx, _miny, _maxx, _maxy, limit)
    if not geojson:
        return {"type": "FeatureCollection", "features": []}
    return geojson

@app.post("/api/layers/{layer_id}/save-features")
def save_layer_features(layer_id: str, req: LayerSaveFeaturesRequest):
    """Saves edited features from In-Browser Web GIS Editor (Draw, Split, Merge, Vertex Edit)."""
    ok = layer_manager.update_layer_features(layer_id, req.geojson_data)
    if not ok:
        raise HTTPException(status_code=500, detail="Không thể lưu chỉnh sửa lớp bản đồ")
    gis_db.reload_layers()
    return {"status": "success", "message": "Đã lưu chỉnh sửa bản đồ vào ổ đĩa thành công!"}

@app.post("/api/layers/{layer_id}/label-config")
def update_layer_label_config(layer_id: str, req: LayerLabelConfigRequest):
    """Updates and persists custom fractional label configuration for a layer."""
    ok = layer_manager.update_layer_label_config(layer_id, req.label_config)
    if not ok:
        raise HTTPException(status_code=404, detail="Không tìm thấy lớp bản đồ")
    return {"status": "success", "message": "Đã lưu cấu hình nhãn phân số thành công!"}

@app.delete("/api/layers/{layer_id}")
def delete_layer(layer_id: str):
    """Permanently deletes a layer and its GeoJSON file."""
    layer_manager.delete_layer(layer_id)
    gis_db.reload_layers()
    return {"status": "success", "message": "Đã xóa lớp bản đồ thành công"}

# --- RED BOOK AUDIT LOG APIS ---
@app.get("/api/redbooks/list")
def list_redbooks(
    query: str = Query(""),
    status: str = Query("")
):
    """Returns list of scanned redbooks with survey notes and matching status."""
    return redbook_manager.get_logs(query=query, status=status)

@app.post("/api/redbooks/save")
def save_redbook_manual(req: RedBookManualSaveRequest):
    """Saves a red book record manually."""
    record = redbook_manager.save_record(req.dict())
    return {"status": "success", "record": record}

@app.delete("/api/redbooks/clear")
def clear_all_redbooks():
    """Deletes all searched red book log entries."""
    count = redbook_manager.clear_all_records()
    return {"status": "success", "deleted_count": count, "message": f"Đã xóa toàn bộ {count} hồ sơ sổ đỏ đã tìm"}

@app.delete("/api/redbooks/{record_id}")
def delete_redbook_record(record_id: str):
    """Deletes a specific red book record by ID."""
    ok = redbook_manager.delete_record(record_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Không tìm thấy hồ sơ sổ đỏ cần xóa")
    return {"status": "success", "message": f"Đã xóa hồ sơ sổ đỏ {record_id}"}

@app.patch("/api/redbooks/{record_id}/notes")
def update_redbook_notes(record_id: str, req: RedBookNoteUpdateRequest):
    """Updates field survey notes or status for a scanned Red Book."""
    ok = redbook_manager.update_notes(record_id, req.notes, req.status)
    if not ok:
        raise HTTPException(status_code=404, detail="Không tìm thấy hồ sơ sổ đỏ")
    return {"status": "success", "message": "Đã cập nhật ghi chú thực địa"}

# --- SATELLITE RASTER EXPORT (.ECW / .EWW / .PRJ) ---
@app.get("/api/export/satellite-raster")
def export_satellite_raster(
    min_lon: float = Query(...),
    min_lat: float = Query(...),
    max_lon: float = Query(...),
    max_lat: float = Query(...),
    province: str = Query("Quảng Ngãi"),
    basemap: str = Query("planet"),
    zoom: int = Query(14)
):
    """
    Exports high-resolution satellite imagery covering the bounding box,
    generates World File (.EWW) and Projection File (.PRJ) in VN-2000,
    and returns a downloadable ZIP archive.
    """
    try:
        zip_bytes = raster_exporter.export_bbox_package(
            min_lon=min_lon,
            min_lat=min_lat,
            max_lon=max_lon,
            max_lat=max_lat,
            province=province,
            basemap=basemap,
            zoom=zoom
        )
        ascii_prov = "QuangNgai" if "Ngãi" in province else ("BinhDinh" if "Định" in province else "PhuYen")
        filename = f"VeTinh_{ascii_prov}_VN2000.zip"
        return Response(
            content=zip_bytes,
            media_type="application/zip",
            headers={
                "Content-Disposition": f"attachment; filename={filename}",
                "Access-Control-Expose-Headers": "Content-Disposition"
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi khi xuất ảnh vệ tinh: {str(e)}")

@app.get("/api/shape-match/demo-sketches")
def get_demo_sketches():
    """Returns pre-generated authentic cadastral sketches for instant 1-click testing."""
    return [
        {
            "id": "demo-qn-bato",
            "title": "Lô rừng Ba Tơ (Quảng Ngãi) - Hình thang",
            "province": "Quảng Ngãi",
            "district": "Ba Tơ",
            "area_ha": 4.85,
            "shape_type": "trapezoid",
            "preview": redbook_helper.generate_demo_redbook_sketch("THUA 124-K2-L01", "trapezoid", 48500.0)
        },
        {
            "id": "demo-bd-hoainhon",
            "title": "Lô rừng Hoài Nhơn (Bình Định) - Hình tam giác",
            "province": "Bình Định",
            "district": "Hoài Nhơn",
            "area_ha": 4.10,
            "shape_type": "triangle",
            "preview": redbook_helper.generate_demo_redbook_sketch("THUA 082-K1-L06", "triangle", 41000.0)
        },
        {
            "id": "demo-py-songhinh",
            "title": "Lô rừng Sông Hinh (Phú Yên) - Hình ngũ giác",
            "province": "Phú Yên",
            "district": "Sông Hinh",
            "area_ha": 8.60,
            "shape_type": "pentagon",
            "preview": redbook_helper.generate_demo_redbook_sketch("THUA 240-K1-L03", "pentagon", 86000.0)
        }
    ]

@app.post("/api/redbook/parse-coordinates")
def parse_coordinate_table(req: CoordinateParseRequest):
    """
    Parses Red Book coordinate table (VN-2000 points 1, 2, 3... X, Y)
    Converts to WGS84 and finds nearest or intersecting forest plots.
    """
    ktt = PROVINCE_CRS_INFO.get(req.province, {}).get("ktt", 108.0)
    parsed_points = redbook_helper.parse_coordinate_table_text(req.coordinate_text, ktt_deg=ktt)
    
    if len(parsed_points) < 3:
        raise HTTPException(status_code=400, detail="Cần tối thiểu 3 điểm tọa độ để tạo đa giác ranh giới")

    # Construct polygon
    wgs_coords = [[p["lon"], p["lat"]] for p in parsed_points]
    if wgs_coords[0] != wgs_coords[-1]:
        wgs_coords.append(wgs_coords[0])

    # Find closest plot
    center_lon = sum(p["lon"] for p in parsed_points) / len(parsed_points)
    center_lat = sum(p["lat"] for p in parsed_points) / len(parsed_points)

    closest_plot = None
    min_dist = float('inf')
    for p in gis_db.plots:
        d = (p["centroid"][0] - center_lon)**2 + (p["centroid"][1] - center_lat)**2
        if d < min_dist:
            min_dist = d
            closest_plot = p

    return {
        "status": "success",
        "points": parsed_points,
        "centroid": [center_lon, center_lat],
        "polygon_geojson": {
            "type": "Polygon",
            "coordinates": [wgs_coords]
        },
        "matched_plot": closest_plot
    }

@app.post("/api/survey/submit")
def submit_field_survey(survey: SurveySubmitRequest):
    """Submits a mobile field inspection record."""
    record = survey.dict()
    record["id"] = f"SURVEY-{len(field_surveys) + 1:04d}"
    field_surveys.append(record)
    return {"status": "success", "survey_id": record["id"], "message": "Đã lưu kết quả khảo sát thực địa"}

@app.get("/api/survey/list")
def list_field_surveys():
    return field_surveys

@app.get("/api/eudr/export")
def export_eudr_geojson():
    """Generates official EUDR Due Diligence Statement (DDS) GeoJSON file."""
    data = eudr_engine.generate_eudr_dds_export(gis_db.plots)
    return JSONResponse(content=data, headers={
        "Content-Disposition": "attachment; filename=EUDR_DDS_Central_Vietnam_Pellets.geojson"
    })

@app.get("/api/eudr/export-excel")
def export_eudr_excel(
    province: str = Query("", description="Lọc theo Tỉnh"),
    operator_name: str = Query("PHÚ TÀI BIOENERGY")
):
    """Exports audit-ready multi-sheet Excel (.xlsx) file for FSC-FM / SBP / EUDR."""
    target_plots = gis_db.plots
    if province:
        target_plots = [p for p in target_plots if province in p.get("province", "")]
    
    excel_bytes = eudr_engine.generate_eudr_excel_report(target_plots, operator_name=operator_name)
    filename = "BaoCao_KiemToan_EUDR_SBP_PhuTai.xlsx"
    return Response(
        content=excel_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f"attachment; filename={filename}",
            "Access-Control-Expose-Headers": "Content-Disposition"
        }
    )

@app.get("/api/tiles/jrc-eudr/{z}/{x}/{y}.png")
def get_jrc_eudr_tile(z: int, x: int, y: int):
    """
    Proxies 256x256 tiles from European Commission JRC Global Forest Cover 2020 WMS
    by calculating EPSG:3857 bounding box from standard slippy map (z, x, y).
    """
    origin_shift = 20037508.342789244
    tile_size = origin_shift * 2.0 / (2.0 ** z)
    min_x = -origin_shift + x * tile_size
    max_x = min_x + tile_size
    max_y = origin_shift - y * tile_size
    min_y = max_y - tile_size
    bbox_str = f"{min_x:.2f},{min_y:.2f},{max_x:.2f},{max_y:.2f}"

    wms_url = (
        f"https://ies-ows.jrc.ec.europa.eu/iforce/gfc2020/wms.py?"
        f"service=WMS&request=GetMap&version=1.1.1&layers=gfc2020_v4&styles=&"
        f"format=image/png&transparent=true&srs=EPSG:3857&width=256&height=256&bbox={bbox_str}"
    )

    try:
        req = urllib.request.Request(wms_url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            content = resp.read()
            return Response(content=content, media_type="image/png", headers={"Cache-Control": "public, max-age=86400"})
    except Exception as e:
        transparent_1x1 = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15c4\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
        return Response(content=transparent_1x1, media_type="image/png")

@app.get("/api/tiles/mbtiles/{layer_id}/{z}/{x}/{y}")
def get_mbtiles_tile(layer_id: str, z: int, x: int, y: int):
    """
    Serves raster (.png, .jpg, .webp) or vector (.pbf) tiles from uploaded MBTiles file.
    Performs TMS coordinate flipping. Returns 1x1 transparent PNG if tile does not exist.
    """
    tile_data, media_type = mbtiles_manager.get_tile(layer_id, z, x, y)
    if not tile_data:
        # For vector tiles (pbf/mvt), MapLibre GL expects HTTP 204 No Content for empty tiles.
        # Returning a PNG causes "Invalid tag / protobuf" errors in vector decoders.
        if mbtiles_manager.is_vector(layer_id):
            return Response(status_code=204)
        # Transparent 1x1 png fallback for raster tiles
        transparent_1x1 = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15c4\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
        return Response(content=transparent_1x1, media_type="image/png")
    
    headers = {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0"
    }
    if media_type == "application/x-protobuf":
        headers["Content-Encoding"] = "gzip"
    return Response(content=tile_data, media_type=media_type, headers=headers)

@app.get("/api/fonts/{fontstack}/{font_range}.pbf")
def get_font_glyphs(fontstack: str, font_range: str):
    """
    Serves font PBF glyphs for MapLibre GL vector and symbol label rendering.
    Supports Vietnamese diacritics and caching on local disk.
    """
    import urllib.parse
    fonts_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "fonts")
    
    import re
    fontstack_unquoted = urllib.parse.unquote(fontstack)
    if not re.fullmatch(r"[0-9]+-[0-9]+", font_range) or any(
        char in fontstack_unquoted for char in ("/", "\\", "\x00")
    ):
        raise HTTPException(status_code=400, detail="Invalid glyph path")
    candidates = [f.strip() for f in fontstack_unquoted.split(",") if f.strip()]
    if "Open Sans Bold" not in candidates:
        candidates.append("Open Sans Bold")
    if "Open Sans Regular" not in candidates:
        candidates.append("Open Sans Regular")
    if "Open Sans Semibold" not in candidates:
        candidates.append("Open Sans Semibold")

    # 1. Check local files
    for font_name in candidates:
        local_pbf = os.path.join(fonts_dir, font_name, f"{font_range}.pbf")
        if os.path.exists(local_pbf) and os.path.getsize(local_pbf) > 0:
            return FileResponse(
                local_pbf,
                media_type="application/x-protobuf",
                headers={"Cache-Control": "public, max-age=31536000"}
            )

    # 2. Try fetching from openmaptiles online and caching locally
    for font_name in candidates[:3]:
        try:
            quoted_font = urllib.parse.quote(font_name)
            url = f"https://fonts.openmaptiles.org/{quoted_font}/{font_range}.pbf"
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = resp.read()
                if data:
                    save_dir = os.path.join(fonts_dir, font_name)
                    os.makedirs(save_dir, exist_ok=True)
                    target_file = os.path.join(save_dir, f"{font_range}.pbf")
                    with open(target_file, "wb") as f_out:
                        f_out.write(data)
                    return Response(
                        content=data,
                        media_type="application/x-protobuf",
                        headers={"Cache-Control": "public, max-age=31536000"}
                    )
        except Exception:
            continue

    raise HTTPException(status_code=404, detail="Glyph range not found")

# --- AUTHENTICATION & MULTI-USER WORKSPACE APIS ---

def get_current_user_optional(authorization: Optional[str] = Header(None)) -> Optional[Dict[str, Any]]:
    if not authorization:
        return None
    token = authorization.replace("Bearer ", "").strip()
    return auth_manager.get_user_by_token(token)

def get_current_user_required(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    user = get_current_user_optional(authorization)
    if not user:
        raise HTTPException(status_code=401, detail="Vui lòng đăng nhập để thực hiện thao tác này")
    return user

@app.post("/api/auth/register")
def register_user(req: UserRegisterRequest):
    if not ALLOW_REGISTRATION:
        raise HTTPException(status_code=403, detail="Đăng ký công khai đã tắt; liên hệ quản trị viên")
    user, msg = auth_manager.register_user(
        username=req.username,
        email=req.email,
        password=req.password,
        full_name=req.full_name,
        department=req.department or "Phòng Bền Vững"
    )
    if not user:
        raise HTTPException(status_code=400, detail=msg)
    user_info, token, _ = auth_manager.login_user(req.username, req.password)
    return {"status": "success", "message": msg, "user": user_info, "token": token}

@app.post("/api/auth/login")
def login_user(req: UserLoginRequest):
    user, token, msg = auth_manager.login_user(req.username, req.password)
    if not user:
        raise HTTPException(status_code=401, detail=msg)
    return {"status": "success", "message": msg, "user": user, "token": token}

@app.get("/api/auth/me")
def get_current_user_profile(authorization: Optional[str] = Header(None)):
    user = get_current_user_required(authorization)
    return {"status": "success", "user": user}

@app.post("/api/auth/logout")
def logout_user(authorization: Optional[str] = Header(None)):
    if authorization:
        token = authorization.replace("Bearer ", "").strip()
        auth_manager.logout_token(token)
    return {"status": "success", "message": "Đã đăng xuất"}

@app.get("/api/user/maps")
def list_user_maps(authorization: Optional[str] = Header(None)):
    user = get_current_user_optional(authorization)
    user_id = user["id"] if user else "guest"
    maps = user_map_manager.list_user_maps(user_id)
    return {"status": "success", "maps": maps, "is_authenticated": bool(user), "user": user}

@app.post("/api/user/maps")
def create_user_map(req: CreateMapRequest, authorization: Optional[str] = Header(None)):
    user = get_current_user_required(authorization)
    m = user_map_manager.create_user_map(
        user_id=user["id"],
        name=req.name,
        description=req.description or "",
        province=req.province or "Quảng Ngãi",
        is_public=req.is_public or False
    )
    return {"status": "success", "map": m, "message": "Đã tạo bản đồ làm việc mới thành công"}

@app.get("/api/user/maps/{map_id}")
def get_user_map_detail(map_id: str, authorization: Optional[str] = Header(None)):
    user = get_current_user_optional(authorization)
    user_id = user["id"] if user else None
    m = user_map_manager.get_user_map(map_id, user_id)
    if not m:
        raise HTTPException(status_code=404, detail="Không tìm thấy bản đồ hoặc bạn không có quyền truy cập")
    return {"status": "success", "map": m}

@app.put("/api/user/maps/{map_id}")
def update_user_map_detail(map_id: str, req: UpdateMapRequest, authorization: Optional[str] = Header(None)):
    user = get_current_user_required(authorization)
    m = user_map_manager.update_user_map(map_id, user["id"], req.dict(exclude_unset=True))
    if not m:
        raise HTTPException(status_code=404, detail="Không tìm thấy bản đồ hoặc bạn không có quyền chỉnh sửa")
    return {"status": "success", "map": m, "message": "Đã cập nhật bản đồ"}

@app.delete("/api/user/maps/{map_id}")
def delete_user_map(map_id: str, authorization: Optional[str] = Header(None)):
    user = get_current_user_required(authorization)
    ok = user_map_manager.delete_user_map(map_id, user["id"])
    if not ok:
        raise HTTPException(status_code=404, detail="Không tìm thấy bản đồ cần xóa")
    return {"status": "success", "message": "Đã xóa bản đồ thành công"}

@app.get("/api/user/maps/{map_id}/layers")
def get_map_layers(map_id: str, authorization: Optional[str] = Header(None)):
    user = get_current_user_optional(authorization)
    user_id = user["id"] if user else "guest"
    result = user_map_manager.list_map_layers(map_id, user_id)
    return {"status": "success", **result}

@app.post("/api/user/maps/{map_id}/layers")
def add_private_layer(map_id: str, req: CreateUserLayerRequest, authorization: Optional[str] = Header(None)):
    user = get_current_user_required(authorization)
    m = user_map_manager.get_user_map(map_id, user["id"])
    if not m or not m["is_owner"]:
        raise HTTPException(status_code=403, detail="Bạn chỉ có thể thêm lớp vào bản đồ của chính mình")

    layer = user_map_manager.add_user_layer(
        map_id=map_id,
        user_id=user["id"],
        name=req.name,
        geojson_data=req.geojson_data,
        source_type=req.source_type or "Bản đồ cá nhân",
        province=req.province or "Quảng Ngãi",
        palette_color=req.palette_color or "#10b981"
    )
    return {"status": "success", "layer": layer, "message": "Đã tạo lớp bản đồ cá nhân thành công"}

@app.get("/api/user/layers/{layer_id}/features")
def get_user_layer_geojson(layer_id: str, authorization: Optional[str] = Header(None)):
    user = get_current_user_optional(authorization)
    user_id = user["id"] if user else None
    geojson = user_map_manager.get_user_layer_geojson(layer_id, user_id)
    if not geojson:
        raise HTTPException(status_code=404, detail="Không tìm thấy dữ liệu lớp bản đồ")
    return geojson

@app.post("/api/user/layers/{layer_id}/save-features")
def save_user_layer_features(layer_id: str, req: LayerSaveFeaturesRequest, authorization: Optional[str] = Header(None)):
    user = get_current_user_required(authorization)
    ok = user_map_manager.save_user_layer_features(layer_id, user["id"], req.geojson_data)
    if not ok:
        raise HTTPException(status_code=404, detail="Không thể lưu hoặc bạn không có quyền sửa lớp này")
    return {"status": "success", "message": "Đã lưu chỉnh sửa đối tượng vào bản đồ cá nhân thành công"}

@app.delete("/api/user/layers/{layer_id}")
def delete_user_layer(layer_id: str, authorization: Optional[str] = Header(None)):
    user = get_current_user_required(authorization)
    ok = user_map_manager.delete_user_layer(layer_id, user["id"])
    if not ok:
        raise HTTPException(status_code=404, detail="Không tìm thấy lớp bản đồ cần xóa")
    return {"status": "success", "message": "Đã xóa lớp bản đồ cá nhân"}

# --- SERVE FRONTEND ---
frontend_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")
data_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")

if os.path.exists(frontend_dir):
    if os.path.exists(os.path.join(frontend_dir, "css")):
        app.mount("/css", StaticFiles(directory=os.path.join(frontend_dir, "css")), name="css")
        app.mount("/static/css", StaticFiles(directory=os.path.join(frontend_dir, "css")), name="static-css")
    if os.path.exists(os.path.join(frontend_dir, "js")):
        app.mount("/js", StaticFiles(directory=os.path.join(frontend_dir, "js")), name="js")
        app.mount("/static/js", StaticFiles(directory=os.path.join(frontend_dir, "js")), name="static-js")
    if os.path.exists(os.path.join(frontend_dir, "assets")):
        app.mount("/assets", StaticFiles(directory=os.path.join(frontend_dir, "assets")), name="assets")
        app.mount("/static/assets", StaticFiles(directory=os.path.join(frontend_dir, "assets")), name="static-assets")

    @app.get("/")
    @app.get("/static/index.html", include_in_schema=False)
    def serve_index():
        return FileResponse(
            os.path.join(frontend_dir, "index.html"),
            headers={
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache",
                "Expires": "0"
            }
        )

# Only explicitly public cartographic assets are served without authentication.
# Never expose SQLite databases, uploads, layer sources, or private workspaces.
public_fonts_dir = os.path.join(data_dir, "fonts")
if os.path.isdir(public_fonts_dir):
    app.mount("/data/fonts", StaticFiles(directory=public_fonts_dir), name="public-fonts")

PUBLIC_DATA_FILES = {
    "provinces_boundaries.geojson", "provinces_boundaries_lines.geojson",
    "quangngai_districts_bbox.json",
}


@app.get("/data/{filename}", include_in_schema=False)
def public_cartographic_data(filename: str):
    if filename not in PUBLIC_DATA_FILES:
        raise HTTPException(status_code=404, detail="Not found")
    for base_dir in (data_dir, os.path.join(frontend_dir, "data")):
        candidate = os.path.join(base_dir, filename)
        if os.path.isfile(candidate):
            return FileResponse(candidate)
    raise HTTPException(status_code=404, detail="Not found")

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    host = os.environ.get("HOST", "0.0.0.0")
    uvicorn.run(app, host=host, port=port)
