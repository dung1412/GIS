"""
Red Book Manager & Cadastral Matching Engine.
Maintains persistent audit log in data/redbooks_log.json.
Compares Red Book cadastral sketches against real plots in uploaded Shapefiles.
Calculates geometric similarity (%) and manages field survey notes.
"""

import os
import json
import uuid
import datetime
from typing import List, Dict, Any, Optional
import cv2
import numpy as np

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
LOG_PATH = os.path.join(DATA_DIR, "redbooks_log.json")

class RedBookManager:
    def __init__(self):
        self._ensure_log()

    def _ensure_log(self):
        if not os.path.exists(LOG_PATH):
            with open(LOG_PATH, "w", encoding="utf-8") as f:
                json.dump([], f, ensure_ascii=False, indent=2)

    def get_logs(self, query: str = "", status: str = "") -> List[Dict[str, Any]]:
        self._ensure_log()
        try:
            with open(LOG_PATH, "r", encoding="utf-8") as f:
                records = json.load(f)
        except Exception:
            return []

        if query:
            q = query.lower()
            records = [
                r for r in records if (
                    q in r.get("owner_name", "").lower() or
                    q in str(r.get("parcel_no", "")).lower() or
                    q in str(r.get("sheet_no", "")).lower() or
                    q in r.get("matched_plot_id", "").lower() or
                    q in r.get("survey_notes", "").lower()
                )
            ]

        if status:
            records = [r for r in records if r.get("status") == status]

        return sorted(records, key=lambda r: r.get("scanned_date", ""), reverse=True)

    def _save_logs(self, logs: List[Dict[str, Any]]):
        with open(LOG_PATH, "w", encoding="utf-8") as f:
            json.dump(logs, f, ensure_ascii=False, indent=2)

    def save_record(self, record: Dict[str, Any]) -> Dict[str, Any]:
        logs = self.get_logs()
        rec_id = f"RB-{datetime.datetime.now().strftime('%Y%m%d')}-{len(logs)+1:04d}"
        
        new_entry = {
            "id": rec_id,
            "owner_name": record.get("owner_name") or "Chưa rõ chủ đất",
            "sheet_no": record.get("sheet_no") or "-",
            "parcel_no": record.get("parcel_no") or "-",
            "province": record.get("province") or "Quảng Ngãi",
            "district": record.get("district") or "-",
            "commune": record.get("commune") or "-",
            "area_m2": float(record.get("area_m2") or 0.0),
            "area_ha": round(float(record.get("area_m2") or 0.0) / 10000, 2),
            "scanned_date": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "matched_plot_id": record.get("matched_plot_id") or "Chưa ghép",
            "similarity_percent": float(record.get("similarity_percent") or 0.0),
            "status": record.get("status") or ("Đã tìm thấy vị trí" if record.get("matched_plot_id") and record.get("matched_plot_id") != "Chưa ghép" else "Chưa tìm thấy vị trí"),
            "survey_notes": record.get("survey_notes") or "",
            "coordinates_text": record.get("coordinates_text") or "",
            "centroid": record.get("centroid") or [108.5, 14.0]
        }

        logs.insert(0, new_entry)
        self._save_logs(logs)
        return new_entry

    def update_notes(self, record_id: str, notes: str, status: Optional[str] = None) -> bool:
        logs = self.get_logs()
        updated = False
        for r in logs:
            if r["id"] == record_id:
                r["survey_notes"] = notes
                if status:
                    r["status"] = status
                updated = True
                break
        if updated:
            self._save_logs(logs)
        return updated

    def delete_record(self, record_id: str) -> bool:
        logs = self.get_logs()
        initial_len = len(logs)
        logs = [r for r in logs if r.get("id") != record_id]
        if len(logs) < initial_len:
            self._save_logs(logs)
            return True
        return False

    def clear_all_records(self) -> int:
        logs = self.get_logs()
        count = len(logs)
        self._save_logs([])
        return count

    def match_against_real_plots(self, input_contour: np.ndarray, 
                                 province: str = "", plots_list: List[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        """
        Compares input contour against all polygons in the uploaded SHP dataset.
        Returns top ranked matches with similarity percentage (0 - 100%).
        """
        if plots_list is None:
            return []

        # Calculate input contour moments
        in_moments = cv2.moments(input_contour)
        in_hu = cv2.HuMoments(in_moments).flatten()
        in_hu_log = -np.sign(in_hu) * np.log10(np.abs(in_hu) + 1e-12)

        # Input aspect ratio and area
        in_rect = cv2.minAreaRect(input_contour)
        w, h = in_rect[1]
        in_aspect = max(w, h) / (min(w, h) + 1e-6)
        in_area = cv2.contourArea(input_contour)

        scored_matches = []

        for p in plots_list:
            if province and p.get("province") != province and p.get("province_code") != province:
                continue

            coords = p.get("coordinates", [])
            if not coords or len(coords) < 3:
                continue

            # Convert coords to local pixel space contour
            pts = np.array(coords, dtype=np.float32)
            pts_norm = pts - np.min(pts, axis=0)
            pts_scaled = (pts_norm * 10000).astype(np.int32)
            target_contour = pts_scaled.reshape((-1, 1, 2))

            # Shape matching via OpenCV MatchShapes (Method 1: I1 difference)
            shape_dist = cv2.matchShapes(input_contour, target_contour, cv2.CONTOURS_MATCH_I1, 0.0)

            # Target aspect ratio
            t_rect = cv2.minAreaRect(target_contour)
            tw, th = t_rect[1]
            t_aspect = max(tw, th) / (min(tw, th) + 1e-6)

            aspect_penalty = abs(in_aspect - t_aspect) / (in_aspect + t_aspect)

            # Similarity calculation
            base_score = max(0.0, 1.0 - shape_dist)
            final_similarity = max(5.0, round((base_score * 0.75 + (1.0 - aspect_penalty) * 0.25) * 100, 1))

            scored_matches.append({
                "plot_id": p["id"],
                "layer_name": p.get("layer_name", "Bản đồ"),
                "province": p["province"],
                "district": p["district"],
                "commune": p["commune"],
                "owner_name": p["owner_name"],
                "area_ha": p["area_ha"],
                "tree_species": p["tree_species"],
                "centroid": p["centroid"],
                "similarity_percent": min(final_similarity, 99.2),
                "shape_dist": round(shape_dist, 4)
            })

        # Sort descending by similarity
        scored_matches.sort(key=lambda m: m["similarity_percent"], reverse=True)
        return scored_matches[:10]

redbook_manager = RedBookManager()
