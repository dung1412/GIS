"""
Red Book (Sổ đỏ) Multi-Tiered Matching Engine for Forestry GIS.
Search Order / Hierarchy:
  1. Chủ rừng (Owner Name): Exact, normalized, TCVN3/ABC, fuzzy matching.
  2. Địa chỉ (Address): Huyện (District), Xã (Commune), Thôn, Thửa số, Tờ BĐ.
  3. So khớp hình thể (Shape Similarity): Hu Moments, Aspect Ratio, Vertex Count on localized candidates.
"""

import os
import json
import sqlite3
import unicodedata
import cv2
import numpy as np
from typing import List, Dict, Any, Optional, Tuple

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
LAYERS_DIR = os.path.join(DATA_DIR, "layers")
CATALOG_PATH = os.path.join(DATA_DIR, "layers_catalog.json")

from shp_importer import decode_vietnamese_font, TCVN3_CHARS, TCVN3_UPPER_SEQUENCES
from shape_matcher import shape_matcher_engine

# Build Unicode to TCVN3 map
UNI_TO_TCVN3 = {}
for k, v in TCVN3_CHARS.items():
    if k not in (0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6):
        UNI_TO_TCVN3[unicodedata.normalize('NFC', v)] = chr(k)
for seq, uni in TCVN3_UPPER_SEQUENCES:
    UNI_TO_TCVN3[unicodedata.normalize('NFC', uni)] = seq

def unicode_to_tcvn3(text: str) -> str:
    if not text:
        return ""
    text = unicodedata.normalize('NFC', text)
    for uni, seq in sorted(UNI_TO_TCVN3.items(), key=lambda x: len(x[0]), reverse=True):
        if uni in text:
            text = text.replace(uni, seq)
    return text

def remove_accents(text: str) -> str:
    if not text:
        return ""
    text = unicodedata.normalize('NFD', text)
    text = ''.join(c for c in text if unicodedata.category(c) != 'Mn')
    return text.lower().replace('đ', 'd').strip()

class RedBookMatcher:
    def __init__(self):
        pass

    def get_active_sqlite_paths(self) -> List[Tuple[str, str]]:
        """Returns list of (layer_id, sqlite_path) for all loaded GIS layers."""
        paths = []
        if os.path.exists(CATALOG_PATH):
            try:
                with open(CATALOG_PATH, "r", encoding="utf-8") as f:
                    catalog = json.load(f)
                for l in catalog:
                    lid = l.get("id")
                    sq_path = os.path.join(LAYERS_DIR, f"{lid}.sqlite")
                    if os.path.exists(sq_path):
                        paths.append((lid, sq_path))
            except Exception:
                pass
        # Default fallback
        def_path = os.path.join(LAYERS_DIR, "layer_098e5fdc.sqlite")
        if os.path.exists(def_path) and ("layer_098e5fdc", def_path) not in paths:
            paths.append(("layer_098e5fdc", def_path))
        return paths

    def polygon_to_contour(self, coords: List[List[float]], target_size: int = 240) -> Optional[np.ndarray]:
        """Converts [lon, lat] coordinates to normalized OpenCV contour."""
        if not coords or len(coords) < 3:
            return None
        pts = np.array(coords, dtype=np.float32)
        if np.allclose(pts[0], pts[-1]):
            pts = pts[:-1]
        if len(pts) < 3:
            return None
        
        pts_norm = pts - np.min(pts, axis=0)
        span = max(np.max(pts_norm[:, 0]), np.max(pts_norm[:, 1]), 1e-6)
        scaled = (pts_norm / span * target_size + 20).astype(np.int32)
        # Flip Y for screen coordinates
        scaled[:, 1] = (target_size + 40) - scaled[:, 1]
        return scaled.reshape((-1, 1, 2))

    def compute_shape_similarity(self, cnt1: np.ndarray, cnt2: np.ndarray) -> float:
        """
        Delegates geometric shape similarity to the upgraded 6-algorithm ensemble
        in ShapeMatcher (which handles partial edge signature for split/merged plots).
        """
        try:
            return shape_matcher_engine.compute_similarity(cnt1, cnt2)
        except Exception:
            return 50.0


    def match_plots(
        self,
        owner_name: Optional[str] = None,
        province: Optional[str] = "Quảng Ngãi",
        district: Optional[str] = None,
        commune: Optional[str] = None,
        parcel_no: Optional[str] = None,
        sheet_no: Optional[str] = None,
        area_ha: Optional[float] = None,
        input_contour: Optional[np.ndarray] = None,
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """
        Executes hierarchical matching following:
          Step 1: Tìm theo Chủ rừng
          Step 2: Tìm theo Địa chỉ (Xã, Huyện)
          Step 3: So khớp hình thể trong khu vực đó
        """
        layer_paths = self.get_active_sqlite_paths()
        if not layer_paths:
            return []

        candidates = {}  # key: (layer_id, rowid) -> dict

        norm_owner = remove_accents(owner_name) if owner_name else ""
        tcvn3_owner = unicode_to_tcvn3(owner_name) if owner_name else ""
        norm_commune = remove_accents(commune) if commune else ""
        norm_district = remove_accents(district) if district else ""

        # Normalize parcel and sheet numbers
        raw_parcel = str(parcel_no).strip() if parcel_no else ""
        p_num = None
        try:
            p_num = float(raw_parcel)
            if p_num.is_integer():
                p_num = int(p_num)
        except Exception:
            pass

        raw_sheet = str(sheet_no).strip() if sheet_no else ""
        s_num = None
        try:
            s_num = float(raw_sheet)
            if s_num.is_integer():
                s_num = int(s_num)
        except Exception:
            pass

        for layer_id, sq_path in layer_paths:
            try:
                con = sqlite3.connect(sq_path)
                cur = con.cursor()

                # --- STEP 0: Cadastral Direct Match (Tìm kiếm chính xác theo Số thửa đất & Tờ BĐ) ---
                # Khi có số thửa đất (ví dụ Thửa 54, Tờ 6): Đây là tiêu chuẩn vàng định danh địa chính
                if raw_parcel:
                    p_query_vals = [raw_parcel]
                    if p_num is not None:
                        p_query_vals.extend([p_num, float(p_num), str(p_num)])
                    # Deduplicate
                    p_query_vals = list(dict.fromkeys(p_query_vals))

                    for pval in p_query_vals:
                        cur.execute(
                            """
                            SELECT rowid, id, props, geom FROM features 
                            WHERE json_extract(props, '$.raw_attributes.thuad') = ?
                               OR json_extract(props, '$.thuad') = ?
                               OR json_extract(props, '$.lot') = ?
                               OR json_extract(props, '$.raw_attributes.lo') = ?
                            LIMIT 100
                            """,
                            (pval, pval, str(pval), str(pval))
                        )
                        for r in cur.fetchall():
                            if (layer_id, r[0]) not in candidates:
                                candidates[(layer_id, r[0])] = (r[1], json.loads(r[2]), json.loads(r[3]), "cadastral_direct")

                # --- STEP 1: Search by Owner Name ---
                if owner_name and owner_name.strip():
                    clean_owner = owner_name.strip()
                    # 1a. Indexed exact query on Unicode
                    cur.execute(
                        "SELECT rowid, id, props, geom FROM features WHERE json_extract(props, '$.owner_name') = ? OR json_extract(props, '$.churung') = ?",
                        (clean_owner, clean_owner)
                    )
                    for r in cur.fetchall():
                        candidates[(layer_id, r[0])] = (r[1], json.loads(r[2]), json.loads(r[3]), "owner_exact")

                    # 1b. Indexed exact query on TCVN3 fallback
                    if clean_owner != tcvn3_owner and tcvn3_owner:
                        cur.execute(
                            "SELECT rowid, id, props, geom FROM features WHERE json_extract(props, '$.owner_name') = ? OR json_extract(props, '$.churung') = ?",
                            (tcvn3_owner, tcvn3_owner)
                        )
                        for r in cur.fetchall():
                            if (layer_id, r[0]) not in candidates:
                                candidates[(layer_id, r[0])] = (r[1], json.loads(r[2]), json.loads(r[3]), "owner_exact")

                    # 1c. LIKE query if candidates are few
                    if len(candidates) < 30:
                        cur.execute(
                            "SELECT rowid, id, props, geom FROM features WHERE json_extract(props, '$.owner_name') LIKE ? OR json_extract(props, '$.churung') LIKE ? LIMIT 50",
                            (f"%{clean_owner}%", f"%{clean_owner}%")
                        )
                        for r in cur.fetchall():
                            if (layer_id, r[0]) not in candidates:
                                candidates[(layer_id, r[0])] = (r[1], json.loads(r[2]), json.loads(r[3]), "owner_like")

                # --- STEP 2: Search by Location (Dò vị trí cả Huyện, không lọc cứng theo Xã) ---
                if (district or commune):
                    # 2a. Nếu có xã, nạp trước các ứng viên trong xã đó
                    if commune and commune.strip():
                        cur.execute(
                            "SELECT rowid, id, props, geom FROM features WHERE json_extract(props, '$.commune') = ? OR json_extract(props, '$.xa') = ? LIMIT 500",
                            (commune.strip(), commune.strip())
                        )
                        for r in cur.fetchall():
                            if (layer_id, r[0]) not in candidates:
                                candidates[(layer_id, r[0])] = (r[1], json.loads(r[2]), json.loads(r[3]), "commune_match")

                    # 2b. Nạp toàn bộ ứng viên trong HUYỆN với dải diện tích rộng linh hoạt
                    effective_dist = (district or "Bình Sơn").strip()
                    if area_ha and area_ha > 0:
                        min_a = max(0.1, area_ha * 0.35)
                        max_a = min(300.0, max(area_ha * 3.0, area_ha + 5.0))
                        sql = """
                            SELECT rowid, id, props, geom FROM features 
                            WHERE (json_extract(props, '$.district') = ? OR json_extract(props, '$.huyen') = ?)
                              AND (COALESCE(json_extract(props, '$.area_ha'), json_extract(props, '$.dientich'), 0) BETWEEN ? AND ?)
                            ORDER BY ABS(COALESCE(json_extract(props, '$.area_ha'), json_extract(props, '$.dientich'), 0) - ?) ASC 
                            LIMIT 1500
                        """
                        cur.execute(sql, (effective_dist, effective_dist, min_a, max_a, area_ha))
                    else:
                        sql = "SELECT rowid, id, props, geom FROM features WHERE json_extract(props, '$.district') = ? OR json_extract(props, '$.huyen') = ? LIMIT 1200"
                        cur.execute(sql, (effective_dist, effective_dist))

                    for r in cur.fetchall():
                        if (layer_id, r[0]) not in candidates:
                            candidates[(layer_id, r[0])] = (r[1], json.loads(r[2]), json.loads(r[3]), "district_match")

                con.close()
            except Exception as e:
                print(f"Error querying SQLite {sq_path}: {e}")

        if not candidates:
            return []

        # --- STEP 3: Multi-factor scoring & Shape Matching ---
        scored_results = []

        for (layer_id, rowid), (plot_id, props, geom, match_src) in candidates.items():
            raw_attrs = props.get("raw_attributes") or {}

            db_owner_raw = props.get("owner_name") or props.get("churung") or raw_attrs.get("churung") or ""
            db_owner = decode_vietnamese_font(db_owner_raw)
            db_district = decode_vietnamese_font(props.get("district") or props.get("huyen") or raw_attrs.get("huyen") or "")
            db_commune = decode_vietnamese_font(props.get("commune") or props.get("xa") or raw_attrs.get("xa") or "")
            
            # Resolve numeric area
            db_area = 0.0
            for a_key in ["area_ha", "dientich", "area"]:
                if props.get(a_key) is not None:
                    try:
                        db_area = float(props[a_key])
                        break
                    except Exception:
                        pass
                if raw_attrs.get(a_key) is not None:
                    try:
                        db_area = float(raw_attrs[a_key])
                        break
                    except Exception:
                        pass

            # Resolve parcel number (Thửa đất)
            db_parcel_raw = raw_attrs.get("thuad") or props.get("thuad") or props.get("so_thua") or raw_attrs.get("so_thua") or props.get("lot") or raw_attrs.get("lo") or ""
            db_parcel_str = str(db_parcel_raw).strip()
            if db_parcel_str.endswith(".0"):
                db_parcel_str = db_parcel_str[:-2]

            # Resolve sheet number (Tờ bản đồ)
            db_sheet_raw = raw_attrs.get("tobando") or props.get("tobando") or props.get("to_bd") or raw_attrs.get("to_bd") or props.get("compartment") or raw_attrs.get("khoanh") or ""
            db_sheet_str = str(db_sheet_raw).strip()
            if db_sheet_str.endswith(".0"):
                db_sheet_str = db_sheet_str[:-2]

            db_species_raw = props.get("tree_species") or props.get("sldlr_t") or props.get("ldlr_t") or raw_attrs.get("ldlr_t") or ""
            db_species = decode_vietnamese_font(db_species_raw)

            # Decode font for sub_compartment, compartment, lot
            db_sub_compartment = decode_vietnamese_font(props.get("sub_compartment") or props.get("tk") or raw_attrs.get("tk") or "-")
            db_compartment = decode_vietnamese_font(props.get("compartment") or props.get("khoanh") or raw_attrs.get("khoanh") or "-")
            db_lot = decode_vietnamese_font(props.get("lot") or props.get("lo") or raw_attrs.get("lo") or "-")

            # Score components (0 to 100)
            score_owner = 0.0
            reasons = []

            # 1. Owner Score
            if owner_name and owner_name.strip():
                if db_owner.strip().lower() == owner_name.strip().lower():
                    score_owner = 100.0
                    reasons.append(f"✓ Trùng khớp chính xác chủ rừng: {db_owner}")
                elif norm_owner and norm_owner == remove_accents(db_owner):
                    score_owner = 90.0
                    reasons.append(f"✓ Trùng tên chủ rừng: {db_owner}")
                elif norm_owner and (norm_owner in remove_accents(db_owner) or remove_accents(db_owner) in norm_owner):
                    score_owner = 70.0
                    reasons.append(f"✓ Trùng một phần tên chủ: {db_owner}")
                else:
                    score_owner = 10.0

            # 2. Location Score (50% huyện, 50% xã)
            score_loc = 0.0
            if district and norm_district in remove_accents(db_district):
                score_loc += 50.0
                reasons.append(f"✓ Đúng địa bàn huyện: {db_district}")
            if commune and norm_commune in remove_accents(db_commune):
                score_loc += 50.0
                reasons.append(f"✓ Đúng địa bàn xã: {db_commune}")
            elif not commune and score_loc > 0:
                score_loc = 100.0  # Tìm theo cả huyện

            # 3. Cadastral Identification (Số Thửa đất & Tờ bản đồ & Diện tích)
            score_cadastral = 0.0
            parcel_matched = False
            sheet_matched = False

            if raw_parcel:
                # Compare both raw string and numeric representation
                is_p_match = (raw_parcel == db_parcel_str)
                if not is_p_match and p_num is not None:
                    try:
                        is_p_match = (float(db_parcel_str) == float(p_num))
                    except Exception:
                        pass
                if is_p_match:
                    score_cadastral += 50.0
                    parcel_matched = True
                    reasons.append(f"✓ Trùng khớp chính xác Số thửa: {db_parcel_str}")

            if raw_sheet:
                is_s_match = (raw_sheet == db_sheet_str)
                if not is_s_match and s_num is not None:
                    try:
                        is_s_match = (float(db_sheet_str) == float(s_num))
                    except Exception:
                        pass
                if is_s_match:
                    score_cadastral += 30.0
                    sheet_matched = True
                    reasons.append(f"✓ Trùng khớp Tờ bản đồ số: {db_sheet_str}")

            if area_ha and area_ha > 0 and db_area > 0:
                diff_pct = abs(db_area - area_ha) / max(area_ha, 0.01)
                if diff_pct <= 0.05:
                    score_cadastral += 20.0
                    reasons.append(f"✓ Diện tích khớp chính xác ~{db_area:.2f} ha (lệch {diff_pct*100:.1f}%)")
                elif diff_pct <= 0.15:
                    score_cadastral += 15.0
                    reasons.append(f"✓ Diện tích khớp ~{db_area:.2f} ha (lệch {diff_pct*100:.1f}%)")
                elif diff_pct <= 0.35:
                    score_cadastral += 10.0
                    reasons.append(f"✓ Diện tích tương cận ~{db_area:.2f} ha (lệch {diff_pct*100:.1f}%)")

            # 4. Shape Similarity Score
            score_shape = 65.0  # default neutral if no contour
            flat_pts = []
            def _extract_pts(obj):
                if isinstance(obj, (list, tuple)):
                    if len(obj) >= 2 and isinstance(obj[0], (int, float)) and isinstance(obj[1], (int, float)):
                        flat_pts.append([float(obj[0]), float(obj[1])])
                    else:
                        for sub in obj:
                            _extract_pts(sub)
            if geom and geom.get("coordinates"):
                _extract_pts(geom["coordinates"])

            if input_contour is not None and len(flat_pts) >= 3:
                target_cnt = self.polygon_to_contour(flat_pts)
                if target_cnt is not None:
                    score_shape = self.compute_shape_similarity(input_contour, target_cnt)
                    if score_shape >= 75.0:
                        reasons.append(f"✓ Hình thể đường bao rất tương đồng ({score_shape:.0f}%)")
                    elif score_shape >= 60.0:
                        reasons.append(f"✓ Hình thể đường bao tương đồng ({score_shape:.0f}%)")

            # --- EXPERT WEIGHTING FORMULA ---
            # If both Parcel No and Sheet No match in the correct commune/district:
            # This is definitive ground-truth cadastral identification (Top 1 absolute).
            if parcel_matched and sheet_matched and score_loc >= 50.0:
                final_score = 95.0 + min(5.0, (100.0 - abs(db_area - area_ha) * 10.0) * 0.05 if area_ha else 3.0)
            elif parcel_matched and score_loc >= 50.0:
                final_score = 88.0 + 0.10 * score_shape
            elif input_contour is not None:
                # Shape matching query with visual sketch
                if parcel_matched or sheet_matched:
                    final_score = 0.40 * score_cadastral + 0.35 * score_shape + 0.25 * score_loc
                elif owner_name and owner_name.strip():
                    if score_loc == 0 and score_cadastral == 0:
                        final_score = 0.50 * score_owner + 0.50 * score_shape
                    else:
                        final_score = 0.35 * score_owner + 0.20 * score_loc + 0.15 * score_cadastral + 0.30 * score_shape
                else:
                    final_score = 0.30 * score_loc + 0.20 * score_cadastral + 0.50 * score_shape
            else:
                # Attribute-only query
                if parcel_matched or sheet_matched:
                    final_score = 0.50 * score_cadastral + 0.35 * score_loc + 0.15 * score_owner
                elif owner_name and owner_name.strip():
                    if score_loc == 0 and score_cadastral == 0:
                        final_score = score_owner * 0.70
                    else:
                        final_score = 0.50 * score_owner + 0.30 * score_loc + 0.20 * score_cadastral
                else:
                    final_score = 0.60 * score_loc + 0.40 * score_cadastral

            # Centroid calculation
            centroid = [108.5, 15.0]
            if flat_pts:
                lons = [c[0] for c in flat_pts]
                lats = [c[1] for c in flat_pts]
                centroid = [round(sum(lons) / len(lons), 6), round(sum(lats) / len(lats), 6)]

            # Candidate Level Classification
            if final_score >= 80.0:
                candidate_level = "candidate_high"
            elif final_score >= 60.0:
                candidate_level = "candidate_medium"
            else:
                candidate_level = "candidate_low"
                if len(reasons) == 0:
                    reasons.append("⚠️ Cảnh báo: Ứng viên có độ tin cậy thấp, chỉ tìm thấy dựa trên vị trí khái quát.")
                else:
                    reasons.append("⚠️ Cảnh báo: Mức độ tương đồng thấp, cần người dùng tự xác nhận.")

            scored_results.append({
                "plot_id": plot_id,
                "rowid": rowid,
                "layer_id": layer_id,
                "candidate_level": candidate_level,
                "owner_name": db_owner,
                "district": db_district,
                "commune": db_commune,
                "sub_compartment": db_sub_compartment,
                "compartment": db_compartment,
                "lot": db_lot,
                "parcel_no": db_parcel_str,
                "sheet_no": db_sheet_str,
                "area_ha": db_area,
                "area_m2": round(db_area * 10000.0, 1),
                "tree_species": db_species,
                "similarity_percent": round(final_score, 1),
                "shape_similarity": round(score_shape, 1),
                "reasons": reasons,
                "centroid": centroid,
                "geojson_geometry": geom
            })

        # Sort descending by composite similarity percent
        scored_results.sort(key=lambda x: x["similarity_percent"], reverse=True)
        return scored_results[:limit]

redbook_matcher = RedBookMatcher()
