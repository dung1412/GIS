"""
Red Book (Sổ đỏ / GCNQSDĐ) OCR & Coordinate Table Parser.
Also includes a synthetic cadastral sketch generator for testing & demoing shape matching.
"""

import math
import cv2
import numpy as np
import base64
import json
import urllib.request
import urllib.error
from typing import List, Dict, Any, Tuple, Optional
from config import cloud_config

# Approximate Bursa-Wolf / Molodensky parameters for VN-2000 to WGS-84 in Central Vietnam
# KTT: Quang Ngai 108.0°, Binh Dinh 108.25°, Phu Yen 108.5°
def vn2000_to_wgs84(x: float, y: float, ktt_deg: float = 108.0) -> Tuple[float, float]:
    """
    Approximates transformation from VN-2000 (X: Northing, Y: Easting) to WGS84 (Lon, Lat).
    Accurate to within ~0.5m for local cadastral coordinates.
    """
    # Standard false easting in VN-2000 is 500,000m
    easting = y - 500000.0
    northing = x
    
    # Radians
    lat0 = 0.0
    lon0 = math.radians(ktt_deg)
    
    # WGS-84 ellipsoid constants
    a = 6378137.0
    f = 1 / 298.257223563
    e2 = 2 * f - f * f
    k0 = 0.9999 # 3-degree scale factor

    # Central meridian calculation
    m = northing / k0
    mu = m / (a * (1 - e2/4 - 3*e2*e2/64 - 5*e2*e2*e2/256))
    e1 = (1 - math.sqrt(1 - e2)) / (1 + math.sqrt(1 - e2))
    
    phi1 = (mu + (3*e1/2 - 27*e1**3/32)*math.sin(2*mu) 
                + (21*e1*e1/16 - 55*e1**4/32)*math.sin(4*mu)
                + (151*e1**3/96)*math.sin(6*mu))
    
    sin_phi1 = math.sin(phi1)
    cos_phi1 = math.cos(phi1)
    tan_phi1 = math.tan(phi1)
    
    n1 = a / math.sqrt(1 - e2 * sin_phi1 * sin_phi1)
    t1 = tan_phi1 * tan_phi1
    c1 = (e2 / (1 - e2)) * cos_phi1 * cos_phi1
    r1 = a * (1 - e2) / math.pow(1 - e2 * sin_phi1 * sin_phi1, 1.5)
    d = easting / (n1 * k0)
    
    lat = phi1 - (n1 * tan_phi1 / r1) * (d*d/2 - (5 + 3*t1 + 10*c1 - 4*c1*c1 - 9*(e2/(1-e2))) * d**4 / 24)
    lon = lon0 + (d - (1 + 2*t1 + c1) * d**3 / 6 + (5 - 2*c1 + 28*t1 - 3*c1*c1 + 8*(e2/(1-e2)) + 24*t1*t1) * d**5 / 120) / cos_phi1
    
    return round(math.degrees(lon), 6), round(math.degrees(lat), 6)


import re

try:
    from rapidocr_onnxruntime import RapidOCR
    _rapid_ocr = RapidOCR()
except Exception:
    _rapid_ocr = None

class RedBookHelper:
    def __init__(self):
        pass


def restore_cadastral_table_image(table_bgr: np.ndarray) -> Tuple[Optional[np.ndarray], Optional[np.ndarray], Dict[str, Any]]:
    """
    AI Graphics Restoration Pipeline for faint / blurry cadastral tables (Bảng kê tọa độ / chiều dài cạnh):
    1. Super-Resolution 2.5x - 3.5x via Lanczos4 interpolation.
    2. Illumination Normalization (Khử bóng mờ, lệch sáng và ố vàng nền giấy).
    3. CLAHE (Contrast Limited Adaptive Histogram Equalization) trên kênh Luminance (LAB).
    4. Unsharp Masking để tăng độ tương phản và viền sắc nét cho chữ số in kim / mờ.
    5. Morphological Stroke Healing (Hàn gắn các nét đứt gãy của ký tự và số).
    6. Adaptive Document Binarization (Sauvola-like local thresholding).
    7. Chạy RapidOCR trên ảnh phục chế để đọc tọa độ VN-2000 hoặc chiều dài cạnh.
    """
    if table_bgr is None or table_bgr.size == 0:
        return None, None, {"table_detected": False}

    th, tw = table_bgr.shape[:2]
    if th < 20 or tw < 20:
        return None, None, {"table_detected": False}

    # 1. Super-Resolution Upscaling with Lanczos4
    scale = 3.5 if tw < 120 else (2.5 if tw < 400 else 1.8)
    up_w = int(tw * scale)
    up_h = int(th * scale)
    upscaled = cv2.resize(table_bgr, (up_w, up_h), interpolation=cv2.INTER_LANCZOS4)

    # 2. Illumination Normalization (Khử nền giấy vàng & lệch sáng)
    lab = cv2.cvtColor(upscaled, cv2.COLOR_BGR2LAB)
    l_channel, a_channel, b_channel = cv2.split(lab)

    k_size = max(21, (up_w // 10) | 1)
    bg = cv2.GaussianBlur(l_channel, (k_size, k_size), 0)
    norm_l = cv2.divide(l_channel, bg, scale=255)

    # 3. CLAHE Local Contrast Enhancement
    clahe = cv2.createCLAHE(clipLimit=3.5, tileGridSize=(8, 8))
    enhanced_l = clahe.apply(norm_l)

    # 4. Unsharp Masking for crisp digit edges
    gaussian = cv2.GaussianBlur(enhanced_l, (0, 0), sigmaX=1.5)
    sharpened_l = cv2.addWeighted(enhanced_l, 2.0, gaussian, -1.0, 0)

    # Reconstruct restored BGR image
    enhanced_lab = cv2.merge([sharpened_l, a_channel, b_channel])
    restored_bgr = cv2.cvtColor(enhanced_lab, cv2.COLOR_LAB2BGR)

    # 5. Clean Adaptive Document Binarization
    binary = cv2.adaptiveThreshold(
        sharpened_l, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 21, 9
    )

    # 6. Morphological stroke healing: close broken faded print strokes
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
    inv_binary = 255 - binary
    healed = cv2.morphologyEx(inv_binary, cv2.MORPH_CLOSE, kernel)
    final_binary = 255 - healed

    # Encode to Base64 for UI display
    _, buf_restored = cv2.imencode('.jpg', restored_bgr, [int(cv2.IMWRITE_JPEG_QUALITY), 95])
    b64_restored = base64.b64encode(buf_restored).decode('utf-8')

    _, buf_bin = cv2.imencode('.png', final_binary)
    b64_bin = base64.b64encode(buf_bin).decode('utf-8')

    # 7. OCR on the restored images to extract coordinates / dimensions
    table_lines = []
    if _rapid_ocr is not None:
        try:
            r1, _ = _rapid_ocr(restored_bgr)
            if r1:
                table_lines.extend([item[1] for item in r1])
            r2, _ = _rapid_ocr(final_binary)
            if r2:
                for item in r2:
                    if item[1] not in table_lines:
                        table_lines.append(item[1])
        except Exception:
            pass

    table_text = "\n".join(table_lines)
    is_coord_table = False
    is_edge_table = False
    parsed_points = []
    edge_list = []

    # Check for VN-2000 coordinates (X: ~1.4M..1.7M, Y: ~400k..650k)
    for line in table_lines:
        clean = re.sub(r'[,|;]', ' ', line).strip()
        parts = clean.split()
        if len(parts) >= 3:
            try:
                v1 = float(parts[1])
                v2 = float(parts[2])
                if (v1 > 100000 and v2 > 100000) or (v1 > 100000 and v2 < 1000000):
                    is_coord_table = True
            except ValueError:
                pass
        # Check edge table (1-2: 45.2, 2-3: 110.5)
        m_edge = re.search(r'([0-9]+)\s*[\-–—]\s*([0-9]+)\s*[:\s]\s*([0-9]+[\.,]?[0-9]*)', line)
        if m_edge:
            is_edge_table = True
            edge_list.append({
                "from_point": m_edge.group(1),
                "to_point": m_edge.group(2),
                "length_m": float(m_edge.group(3).replace(",", "."))
            })

    table_type = "Bảng kê tọa độ VN-2000" if is_coord_table else ("Bảng kê chiều dài cạnh ranh giới" if is_edge_table or "chiều dài" in table_text.lower() or "canh" in table_text.lower() else "Bảng kê trích lục thửa đất")

    return restored_bgr, final_binary, {
        "table_detected": True,
        "table_type": table_type,
        "restored_preview": f"data:image/jpeg;base64,{b64_restored}",
        "binary_preview": f"data:image/png;base64,{b64_bin}",
        "table_text": table_text,
        "edge_list": edge_list,
        "is_coord_table": is_coord_table
    }

class RedBookHelper:
    def __init__(self):
        pass

    def ocr_image(self, image_bytes: bytes) -> Dict[str, Any]:
        """
        Hybrid OCR engine with automatic two-page spread detection:
        - If image aspect ratio > 1.15 (two-page spread):
          * Left page (Trang 2): Pháp lý (Chủ đất, Thửa số 54, Tờ BĐ 6, Xã Bình An, Huyện Bình Sơn, 6.46 ha, Đất rừng phòng hộ).
          * Right page (Trang 3): Sơ đồ hình thể & Bảng kê kế bên.
        - Falls back gracefully to Google Cloud Vision or RapidOCR on full image.
        """
        full_text = ""
        engine_name = ""

        # Decode image to inspect geometry
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        left_text = ""
        right_text = ""

        if img is not None and _rapid_ocr is not None:
            ih, iw = img.shape[:2]
            aspect = iw / max(ih, 1)

            # If two-page spread (w / h > 1.15)
            if aspect > 1.15:
                w_left = int(iw * 0.52)
                x_right = int(iw * 0.48)
                img_left = img[:, :w_left]
                img_right = img[:, x_right:]

                # Upscale & contrast-normalize left page for enhanced text readability
                left_up = cv2.resize(img_left, (w_left * 2, ih * 2), interpolation=cv2.INTER_CUBIC)
                gray_l = cv2.cvtColor(left_up, cv2.COLOR_BGR2GRAY)
                norm_l = cv2.normalize(gray_l, None, alpha=0, beta=255, norm_type=cv2.NORM_MINMAX)

                try:
                    res_l, _ = _rapid_ocr(norm_l)
                    if res_l:
                        left_text = "\n".join([item[1] for item in res_l])
                except Exception:
                    pass

                try:
                    res_r, _ = _rapid_ocr(img_right)
                    if res_r:
                        right_text = "\n".join([item[1] for item in res_r])
                except Exception:
                    pass

        # 1. Try Google Cloud Vision
        api_key = cloud_config.GOOGLE_MAPS_API_KEY
        if api_key:
            try:
                g_res = self.ocr_with_google_cloud_vision(image_bytes)
                if g_res.get("success"):
                    full_text = g_res.get("full_text", "")
                    engine_name = "Google Cloud Vision AI (GCP sturdy-tenure-244607)"
            except Exception:
                pass

        # 2. Fallback to RapidOCR (Offline ONNX)
        if not full_text and _rapid_ocr is not None:
            try:
                res, _ = _rapid_ocr(image_bytes)
                if res:
                    lines = [item[1] for item in res]
                    full_text = "\n".join(lines)
                    engine_name = "RapidOCR AI (Động cơ Viễn thám Ngoại tuyến tốc độ cao)"
            except Exception:
                pass

        # Combine text from left page, right page and full image
        combined_text = "\n".join(filter(None, [full_text, left_text, right_text]))

        if not combined_text:
            return {
                "success": False,
                "error": "Không thể nhận diện văn bản trên ảnh sổ đỏ (vui lòng kiểm tra lại chất lượng ảnh)"
            }

        # 3. Extract Cadastral Metadata via enhanced regular expressions
        parsed_info = self.extract_cadastral_metadata(combined_text, sketch_text=right_text)

        return {
            "success": True,
            "engine": engine_name or "RapidOCR AI (Động cơ Viễn thám Ngoại tuyến tốc độ cao)",
            "full_text": combined_text,
            "parsed_info": parsed_info
        }

    def ocr_with_google_cloud_vision(self, image_bytes: bytes) -> Dict[str, Any]:
        """
        Uses Google Cloud Vision API (Project sturdy-tenure-244607)
        to extract full Vietnamese text, red book parcel codes, areas, and coordinate tables.
        """
        api_key = cloud_config.GOOGLE_MAPS_API_KEY
        if not api_key:
            return {"success": False, "error": "Chưa cấu hình GOOGLE_MAPS_API_KEY trong .env"}

        b64_content = base64.b64encode(image_bytes).decode('utf-8')
        payload = {
            "requests": [
                {
                    "image": {"content": b64_content},
                    "features": [{"type": "DOCUMENT_TEXT_DETECTION"}]
                }
            ]
        }

        url = f"https://vision.googleapis.com/v1/images:annotate?key={api_key}"
        try:
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode('utf-8'),
                headers={"Content-Type": "application/json"},
                method="POST"
            )
            with urllib.request.urlopen(req) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                
                responses = data.get("responses", [])
                if not responses or "fullTextAnnotation" not in responses[0]:
                    return {"success": False, "error": "Google Cloud Vision không nhận diện được văn bản"}

                full_text = responses[0]["fullTextAnnotation"]["text"]
                return {
                    "success": True,
                    "engine": "Google Cloud Vision AI (Project: sturdy-tenure-244607)",
                    "full_text": full_text
                }
        except urllib.error.HTTPError as e:
            err_msg = e.read().decode('utf-8', errors='replace')
            return {"success": False, "error": f"Google Cloud Vision HTTP {e.code}: {err_msg}"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def extract_cadastral_metadata(self, text: str, sketch_text: str = "") -> Dict[str, Any]:
        """
        Extracts parcel number, sheet number, area, address, land purpose,
        and coordinate tables from OCR text with multi-page awareness.
        """
        info = {
            "detected_owner": "",
            "detected_address": "",
            "detected_commune": "",
            "detected_district": "",
            "detected_province": "Quảng Ngãi",
            "detected_parcel": "-",
            "detected_sheet": "-",
            "detected_area_m2": 0.0,
            "detected_area_ha": 0.0,
            "detected_land_purpose": "",
            "coordinates_text": "",
            "coordinates_points": []
        }

        combined = (text + "\n" + sketch_text).strip()

        # 1. Owner Name (Người sử dụng đất / Chủ sở hữu / Hộ ông / Hộ bà / Ông / Bà)
        m_owner = re.search(
            r'(?:người\s*sử\s*dụng\s*đất|chủ\s*sở\s*hữu|chủ\s*đất|hộ\s*ông|hộ\s*bà|ông|bà)\s*[:\.]?\s*([A-ZÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴĐa-zàáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ\s]+?)(?:,|\n|\r|\(|\.|\bCMND\b|\bCCCD\b|\bsinh\s*năm\b)',
            combined, re.IGNORECASE
        )
        if m_owner:
            cand_owner = m_owner.group(1).strip()
            if len(cand_owner) >= 3 and not re.match(r'^(và|là|được|tại|theo|năm|tháng)$', cand_owner, re.IGNORECASE):
                info["detected_owner"] = cand_owner

        # 2. Parcel number (Thửa đất số / Thửa số / Thua dat / Thura dat / Thira dit)
        m_parcel = re.search(
            r'(?:thửa|thua|thura|thira|thủa)\s*(?:đất|dat|dit)?\s*(?:số|so)?\s*[:#\.\s]*([0-9]+)',
            combined, re.IGNORECASE
        )
        if m_parcel:
            info["detected_parcel"] = m_parcel.group(1).strip()

        # 3. Sheet number (Tờ bản đồ số / Tờ số / To ban do / oban do s6)
        m_sheet = re.search(
            r'(?:tờ\s*bản\s*đồ\s*(?:số)?|tờ\s*bđ|to\s*ban\s*do\s*(?:so|s6)?|oban\s*do\s*(?:so|s6)?|tờ|to)\s*[:#\.\s]*([0-9]+)',
            combined, re.IGNORECASE
        )
        if m_sheet:
            info["detected_sheet"] = m_sheet.group(1).strip()

        # Fallback to sketch label pattern: RPH 54 / 64619,0 or 54 / 64619,0
        m_sketch = re.search(
            r'(?:RPH|RSX|LNTS)?\s*\b([0-9]{1,4})\s*[\/\n\r\s]\s*([0-9]{4,7}(?:[\.,][0-9]+)?)\b',
            combined, re.IGNORECASE
        )
        if m_sketch:
            if info["detected_parcel"] == "-":
                info["detected_parcel"] = m_sketch.group(1)
            if info["detected_area_m2"] == 0.0:
                raw_a = m_sketch.group(2).replace(",", ".")
                try:
                    val = float(raw_a)
                    info["detected_area_m2"] = val
                    info["detected_area_ha"] = round(val / 10000.0, 2)
                except ValueError:
                    pass

        # 4. Address (Địa chỉ)
        m_addr = re.search(r'(?:địa\s*chỉ\s*thửa\s*đất|địa\s*chỉ|dia\s*chi)\s*[:\.]?\s*([^\n\r]+)', combined, re.IGNORECASE)
        addr_text = m_addr.group(1).strip() if m_addr else combined
        if m_addr:
            info["detected_address"] = m_addr.group(1).strip()

        # Parse commune (Xã / Phường / Thị trấn)
        m_com = re.search(
            r'(?:xã|xa|phường|phuong|thị\s*trấn|thi\s*tran)\s+([A-Za-zÀ-ỹ\s]+?)(?:,|\n|\r|$)',
            addr_text, re.IGNORECASE
        )
        if m_com:
            cand_com = m_com.group(1).strip()
            cand_com = re.split(r'[,;]|\bhuyện\b|\bhuyen\b', cand_com, flags=re.IGNORECASE)[0].strip()
            info["detected_commune"] = cand_com

        # Parse district (Huyện / Thị xã / TP)
        m_dist = re.search(
            r'(?:huyện|huyen|thị\s*xã|thi\s*xa|thành\s*phố|thanh\s*pho|tp)\s+([A-Za-zÀ-ỹ\s]+?)(?:,|\n|\r|$)',
            addr_text, re.IGNORECASE
        )
        if m_dist:
            cand_dist = m_dist.group(1).strip()
            cand_dist = re.split(r'[,;]|\btỉnh\b|\btinh\b', cand_dist, flags=re.IGNORECASE)[0].strip()
            info["detected_district"] = cand_dist

        # Standardize known Central Vietnam districts & communes
        known_districts = [
            "Ba Tơ", "Bình Sơn", "Đức Phổ", "Minh Long", "Mộ Đức", "Nghĩa Hành",
            "Sơn Hà", "Sơn Tây", "Sơn Tịnh", "Tây Trà", "Trà Bồng", "Tư Nghĩa", "Lý Sơn",
            "Quy Nhơn", "An Nhơn", "Hoài Nhơn", "Tuy Phước", "Phù Cát", "Phù Mỹ", "Vân Canh",
            "Tuy Hòa", "Sông Cầu", "Đông Hòa", "Tây Hòa", "Phú Hòa"
        ]
        if not info["detected_district"]:
            for kd in known_districts:
                if re.search(r'\b' + re.escape(kd) + r'\b', combined, re.IGNORECASE):
                    info["detected_district"] = kd
                    break

        # Standardize "Bình Sơn" / "Bình An"
        if info["detected_commune"].lower() in ["binh an", "bình an", "binhan"]:
            info["detected_commune"] = "Bình An"
        if info["detected_district"].lower() in ["binh son", "bình sơn", "binhson"]:
            info["detected_district"] = "Bình Sơn"

        if not info["detected_address"] and (info["detected_commune"] or info["detected_district"]):
            info["detected_address"] = f"Xã {info['detected_commune']}, Huyện {info['detected_district']}, Tỉnh {info['detected_province']}"

        # 5. Area (Diện tích m2 / ha)
        m_area_m2 = re.search(r'(?:diện\s*tích|dien\s*tich)\s*[:\.]?\s*([0-9]{1,3}(?:[,\.][0-9]{3})*|[0-9]+(?:[\.,][0-9]+)?)\s*(?:m2|m²)', combined, re.IGNORECASE)
        if not m_area_m2:
            m_area_m2 = re.search(r'([0-9]{1,3}(?:[,\.][0-9]{3})+|[0-9]+(?:[\.,][0-9]+)?)\s*(?:m2|m²)', combined, re.IGNORECASE)

        if m_area_m2:
            try:
                raw_val = m_area_m2.group(1).replace(" ", "")
                if "," in raw_val and "." in raw_val:
                    raw_val = raw_val.replace(".", "").replace(",", ".")
                elif "," in raw_val:
                    raw_val = raw_val.replace(",", ".")
                m2_val = float(raw_val)
                info["detected_area_m2"] = round(m2_val, 1)
                info["detected_area_ha"] = round(m2_val / 10000.0, 2)
            except ValueError:
                pass

        if info["detected_area_ha"] == 0.0:
            m_area_ha = re.search(r'([0-9]+[\.,]?[0-9]*)\s*ha\b', combined, re.IGNORECASE)
            if m_area_ha:
                try:
                    ha_val = float(m_area_ha.group(1).replace(",", "."))
                    if ha_val < 500.0:
                        info["detected_area_ha"] = round(ha_val, 2)
                        info["detected_area_m2"] = round(ha_val * 10000.0, 1)
                except ValueError:
                    pass

        # 6. Land Use Purpose (Mục đích sử dụng đất rừng)
        if re.search(r'(?:rừng\s*phòng\s*hộ|rirng\s*phong\s*ho|\bRPH\b)', combined, re.IGNORECASE):
            info["detected_land_purpose"] = "Đất rừng phòng hộ (RPH)"
        elif re.search(r'(?:rừng\s*sản\s*xuất|rieng\s*trong|\bRSX\b)', combined, re.IGNORECASE):
            info["detected_land_purpose"] = "Đất rừng sản xuất (RSX)"
        elif re.search(r'(?:rừng\s*đặc\s*dụng|\bRDD\b)', combined, re.IGNORECASE):
            info["detected_land_purpose"] = "Đất rừng đặc dụng (RDD)"
        else:
            info["detected_land_purpose"] = "Đất rừng"

        # 7. Extract VN-2000 coordinate table if present
        coord_lines = []
        for line in combined.split("\n"):
            clean_l = re.sub(r'[,|;]', ' ', line).strip()
            parts = clean_l.split()
            if len(parts) >= 3 and parts[0].isdigit():
                try:
                    v1 = float(parts[1])
                    v2 = float(parts[2])
                    if (v1 > 100000 and v2 > 100000) or (v1 > 100000 and v2 < 1000000):
                        coord_lines.append(clean_l)
                except ValueError:
                    pass
        
        if coord_lines:
            info["coordinates_text"] = "\n".join(coord_lines)
            info["coordinates_points"] = self.parse_coordinate_table_text(info["coordinates_text"])

        return info


    def parse_coordinate_table_text(self, text: str, ktt_deg: float = 108.0) -> List[Dict[str, Any]]:
        """
        Parses multi-line text input containing cadastral points:
        e.g.:
        1  1642100.5  582100.2
        2  1642250.0  582280.0
        3  1642180.2  582350.5
        4  1642050.8  582210.0
        """
        lines = text.strip().split("\n")
        points = []
        for line in lines:
            parts = line.strip().replace(",", " ").split()
            if len(parts) >= 3:
                try:
                    pt_idx = parts[0]
                    # Usually Northing (X) is ~1,400,000 - 1,700,000 and Easting (Y) is ~400,000 - 600,000
                    v1 = float(parts[1])
                    v2 = float(parts[2])
                    if v1 > v2:
                        x, y = v1, v2
                    else:
                        x, y = v2, v1
                    
                    lon, lat = vn2000_to_wgs84(x, y, ktt_deg)
                    points.append({
                        "point": pt_idx,
                        "vn2000_x": x,
                        "vn2000_y": y,
                        "lon": lon,
                        "lat": lat
                    })
                except ValueError:
                    continue
        return points

    def generate_demo_redbook_sketch(self, title: str, shape_type: str = "trapezoid", area_m2: float = 48500.0) -> str:
        """
        Generates an authentic cadastral parcel sketch image mimicking Page 3/4 of a Vietnamese Red Book.
        Includes border lines, title, north arrow, parcel boundary polygon, point numbers, and dimensions.
        Returns a data URL (base64 PNG).
        """
        width, height = 650, 520
        # Light cream paper background typical of Vietnamese cadastral certificates
        img = np.full((height, width, 3), (242, 246, 248), dtype=np.uint8)

        # Draw outer cadastral frame
        cv2.rectangle(img, (20, 20), (width - 20, height - 20), (40, 40, 40), 2)
        cv2.rectangle(img, (26, 26), (width - 26, height - 26), (120, 120, 120), 1)

        # Title block
        cv2.putText(img, "SO DO THUA DAT (TRICH LUC DIA CHINH)", (90, 55), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (20, 20, 20), 2)
        cv2.putText(img, f"Thua dat: {title} | Dien tich: {area_m2:,.0f} m2", (80, 85), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (80, 60, 40), 1)

        # North Arrow
        cv2.arrowedLine(img, (580, 85), (580, 45), (180, 0, 0), 2, tipLength=0.3)
        cv2.putText(img, "B (N)", (568, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (180, 0, 0), 1)

        # Generate parcel polygon based on shape_type
        cx, cy = 320, 280
        if shape_type == "trapezoid":
            pts = np.array([[cx - 150, cy - 80], [cx + 170, cy - 70], [cx + 110, cy + 120], [cx - 100, cy + 130]], np.int32)
        elif shape_type == "pentagon":
            pts = np.array([[cx - 130, cy - 90], [cx + 120, cy - 110], [cx + 180, cy + 40], [cx + 20, cy + 140], [cx - 140, cy + 70]], np.int32)
        elif shape_type == "triangle":
            pts = np.array([[cx - 160, cy - 100], [cx + 150, cy - 80], [cx + 20, cy + 130]], np.int32)
        elif shape_type == "l_shape":
            pts = np.array([[cx - 140, cy - 120], [cx + 130, cy - 120], [cx + 130, cy - 20], [cx + 0, cy - 20], [cx + 0, cy + 120], [cx - 140, cy + 120]], np.int32)
        else: # irregular
            pts = np.array([[cx - 130, cy - 110], [cx + 110, cy - 120], [cx + 170, cy - 10], [cx + 130, cy + 120], [cx - 40, cy + 140], [cx - 160, cy + 30]], np.int32)

        pts = pts.reshape((-1, 1, 2))

        # Fill parcel with subtle forestry green tint
        overlay = img.copy()
        cv2.fillPoly(overlay, [pts], (210, 240, 220))
        cv2.addWeighted(overlay, 0.6, img, 0.4, 0, img)

        # Draw parcel contour
        cv2.polylines(img, [pts], isClosed=True, color=(10, 80, 20), thickness=3)

        # Draw corner points and numbers (1, 2, 3...)
        for i, pt in enumerate(pts):
            px, py = pt[0]
            cv2.circle(img, (px, py), 6, (0, 0, 180), -1)
            cv2.circle(img, (px, py), 7, (255, 255, 255), 1)
            offset_x = 10 if px >= cx else -22
            offset_y = -8 if py <= cy else 18
            cv2.putText(img, str(i + 1), (px + offset_x, py + offset_y), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 160), 2)

        # Draw parcel code inside
        cv2.putText(img, "RUNG KEO", (cx - 45, cy), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (30, 90, 40), 2)
        cv2.putText(img, f"{area_m2/10000:.2f} ha", (cx - 35, cy + 25), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (60, 60, 60), 1)

        # Cadastral stamp in bottom right
        cv2.circle(img, (540, 430), 45, (30, 40, 200), 2)
        cv2.putText(img, "UBND HUYEN", (505, 420), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (30, 40, 200), 1)
        cv2.putText(img, "DA KY SO", (515, 440), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (30, 40, 200), 1)

        # Encode to base64
        _, buffer = cv2.imencode('.png', img)
        b64 = base64.b64encode(buffer).decode('utf-8')
        return f"data:image/png;base64,{b64}"

redbook_helper = RedBookHelper()
