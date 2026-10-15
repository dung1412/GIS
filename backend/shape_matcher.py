"""
Shape Similarity Matching Engine for Red Book (Sổ đỏ) Cadastral Sketches.
UPGRADED: Multi-algorithm ensemble with:
  1. Hu Moments I1 (translation/scale/rotation invariant global descriptor)
  2. Normalized Turn Angle Sequence (NAD) - sensitive to corner structures of cadastral shapes
  3. Directed Hausdorff Distance (shape boundary fidelity)
  4. Edge Length Distribution (ratio comparison of sorted edge lengths)
  5. Aspect Ratio (coarse sanity check)
"""

import cv2
import numpy as np
from typing import List, Dict, Any, Tuple, Optional
import base64
import io

from redbook_ocr import restore_cadastral_table_image


# ==============================================================================
# MODULE-LEVEL SHAPE ANALYSIS HELPERS
# ==============================================================================

def _polygon_pts(cnt: np.ndarray) -> np.ndarray:
    """Flatten (N,1,2) contour to (N,2) float array."""
    if cnt is None or len(cnt) == 0:
        return np.empty((0, 2), dtype=np.float32)
    return cnt.reshape(-1, 2).astype(np.float32)


def _normalize_polygon(pts: np.ndarray, n_pts: int = 64) -> np.ndarray:
    """
    Resamples polygon to exactly n_pts equally-spaced points, normalizes
    to zero-mean + unit-scale. Returns (n_pts, 2) float32 array.
    """
    if len(pts) < 3:
        return np.zeros((n_pts, 2), dtype=np.float32)
    closed = pts if np.allclose(pts[0], pts[-1]) else np.vstack([pts, pts[0:1]])
    dists = np.linalg.norm(np.diff(closed, axis=0), axis=1)
    cum = np.concatenate([[0.0], np.cumsum(dists)])
    total = cum[-1]
    if total < 1e-9:
        return np.zeros((n_pts, 2), dtype=np.float32)
    target = np.linspace(0.0, total, n_pts, endpoint=False)
    rx = np.interp(target, cum, closed[:, 0])
    ry = np.interp(target, cum, closed[:, 1])
    resampled = np.column_stack([rx, ry])
    resampled -= resampled.mean(axis=0)
    scale = np.max(np.linalg.norm(resampled, axis=1))
    if scale > 1e-9:
        resampled /= scale
    return resampled.astype(np.float32)


def _turn_angle_similarity(pts1: np.ndarray, pts2: np.ndarray, n_pts: int = 48) -> float:
    """
    Compares normalized turn angle sequences after uniform resampling.
    Uses cyclic shift to achieve rotation-start invariance.
    Returns 0-100 similarity. Most discriminative for irregular polygon corners.
    """
    def _angles(pts):
        n = len(pts)
        if n < 3:
            return np.array([])
        angles = []
        for i in range(n):
            v1 = pts[i] - pts[(i - 1) % n]
            v2 = pts[(i + 1) % n] - pts[i]
            a1 = np.arctan2(float(v1[1]), float(v1[0]))
            a2 = np.arctan2(float(v2[1]), float(v2[0]))
            turn = (a2 - a1 + np.pi) % (2 * np.pi) - np.pi
            angles.append(turn)
        return np.array(angles) / np.pi  # normalize to [-1,1]

    ta1 = _angles(pts1)
    ta2 = _angles(pts2)
    if len(ta1) < 4 or len(ta2) < 4:
        return 50.0

    # Resample both to n_pts
    x1 = np.linspace(0, 1, len(ta1))
    x2 = np.linspace(0, 1, len(ta2))
    xn = np.linspace(0, 1, n_pts)
    ta1r = np.interp(xn, x1, ta1)
    ta2r = np.interp(xn, x2, ta2)

    # Best alignment using cyclic shifts (8 trials)
    min_dist = min(
        float(np.mean(np.abs(ta1r - np.roll(ta2r, shift))))
        for shift in range(0, n_pts, max(1, n_pts // 8))
    )
    return float(max(0.0, 100.0 * (1.0 - min(min_dist / 0.8, 1.0))))


def _hausdorff_similarity(pts1: np.ndarray, pts2: np.ndarray, n_pts: int = 64) -> float:
    """
    Normalized bidirectional Hausdorff Distance on unit-normalized polygon pairs.
    Returns 0-100 similarity.
    """
    norm1 = _normalize_polygon(pts1, n_pts)
    norm2 = _normalize_polygon(pts2, n_pts)
    if norm1.shape[0] < 3 or norm2.shape[0] < 3:
        return 50.0

    best_hd = float('inf')
    for shift in range(0, n_pts, max(1, n_pts // 8)):
        n2s = np.roll(norm2, shift, axis=0)
        # Compute directed hausdorff manually (avoid scipy dependency issues)
        # d(A->B) = max_a min_b ||a - b||
        diff1 = norm1[:, None, :] - n2s[None, :, :]  # (n,n,2)
        dists1 = np.linalg.norm(diff1, axis=2)       # (n,n)
        d_ab = float(np.max(np.min(dists1, axis=1)))
        d_ba = float(np.max(np.min(dists1, axis=0)))
        hd = max(d_ab, d_ba)
        if hd < best_hd:
            best_hd = hd

    return float(max(0.0, 100.0 * (1.0 - min(best_hd / 0.6, 1.0))))


def _edge_length_similarity(pts1: np.ndarray, pts2: np.ndarray) -> float:
    """
    Compares sorted normalized edge length distributions (top-K edges).
    Captures the characteristic shape of cadastral plots (e.g. one long boundary road edge).
    Returns 0-100 similarity.
    """
    def _sorted_edges(pts):
        if len(pts) < 3:
            return np.array([])
        closed = np.vstack([pts, pts[0:1]])
        lengths = np.linalg.norm(np.diff(closed, axis=0), axis=1)
        total = lengths.sum()
        if total < 1e-9:
            return np.array([])
        return np.sort(lengths / total)[::-1]  # descending normalized

    e1 = _sorted_edges(pts1)
    e2 = _sorted_edges(pts2)
    if len(e1) < 3 or len(e2) < 3:
        return 50.0
    k = min(len(e1), len(e2), 8)
    mean_diff = float(np.abs(e1[:k] - e2[:k]).mean())
    return float(max(0.0, 100.0 * (1.0 - min(mean_diff / 0.3, 1.0))))


def _partial_edge_signature_similarity(pts1: np.ndarray, pts2: np.ndarray) -> float:
    """
    Compares the edge signature (length ratios and turn angles) to find the best 
    partial match of consecutive edges (useful for split/merged plots).
    Returns 0-100 similarity.
    """
    def extract_sig(pts):
        if len(pts) < 3: return [], []
        peri = cv2.arcLength(pts, True)
        approx = cv2.approxPolyDP(pts, 0.015 * peri, True)
        if len(approx) < 3: approx = pts
        approx = approx.reshape(-1, 2)
        n = len(approx)
        edges = []
        angles = []
        for i in range(n):
            v = approx[(i + 1) % n] - approx[i]
            edges.append(max(float(np.linalg.norm(v)), 1e-5))
        for i in range(n):
            v1 = approx[i] - approx[(i - 1) % n]
            v2 = approx[(i + 1) % n] - approx[i]
            a1 = np.arctan2(v1[1], v1[0])
            a2 = np.arctan2(v2[1], v2[0])
            turn = (a2 - a1 + np.pi) % (2 * np.pi) - np.pi
            angles.append(float(np.degrees(turn)))
        return edges, angles
        
    e1, a1 = extract_sig(pts1)
    e2, a2 = extract_sig(pts2)
    
    if len(e1) < 2 or len(e2) < 2: return 50.0
    
    n1, n2 = len(e1), len(e2)
    best_score = 0.0
    
    for k in range(2, min(n1, n2) + 1):
        if k == 2: max_possible = 65.0
        elif k == 3: max_possible = 85.0
        else: max_possible = 100.0
            
        for i in range(n1):
            for j in range(n2):
                angle_diffs = []
                ratio_diffs = []
                for step in range(k - 1):
                    idx1_a = (i + step + 1) % n1
                    idx2_a = (j + step + 1) % n2
                    angle_diffs.append(abs(a1[idx1_a] - a2[idx2_a]))
                    
                    r1 = e1[(i + step) % n1] / e1[(i + step + 1) % n1]
                    r2 = e2[(j + step) % n2] / e2[(j + step + 1) % n2]
                    ratio_diffs.append(1.0 - min(r1, r2) / max(r1, r2))
                
                mean_angle_diff = sum(angle_diffs) / len(angle_diffs)
                mean_ratio_diff = sum(ratio_diffs) / len(ratio_diffs)
                
                score_a = max(0, 1.0 - mean_angle_diff / 25.0)
                score_r = max(0, 1.0 - mean_ratio_diff / 0.3)
                
                match_quality = (score_a * 0.7 + score_r * 0.3)
                final_score = match_quality * max_possible
                
                coverage = k / max(n1, n2)
                if coverage < 0.2:
                    final_score *= 0.8
                
                if final_score > best_score:
                    best_score = final_score
                    
    return float(min(100.0, best_score))


class ShapeMatcher:
    def __init__(self):
        pass

    def polygon_to_contour(self, coords: List[List[float]], target_size: int = 300) -> np.ndarray:
        """
        Converts geographic [lon, lat] coordinates to a normalized OpenCV contour (N, 1, 2)
        scaled inside a [target_size, target_size] bounding box.
        """
        pts = np.array(coords, dtype=np.float32)
        if len(pts) < 3:
            return np.zeros((1, 1, 2), dtype=np.int32)
        
        # Remove duplicate closing point if present
        if np.allclose(pts[0], pts[-1]):
            pts = pts[:-1]

        # Shift to origin
        min_xy = pts.min(axis=0)
        max_xy = pts.max(axis=0)
        diff = max_xy - min_xy
        
        # Avoid division by zero
        span = max(diff[0], diff[1], 1e-6)
        normalized = (pts - min_xy) / span * (target_size * 0.8) + (target_size * 0.1)

        # Invert Y axis for screen space
        normalized[:, 1] = target_size - normalized[:, 1]
        
        contour = normalized.astype(np.int32).reshape((-1, 1, 2))
        return contour

    def extract_contour_from_image_bytes(
        self, image_bytes: bytes, roi_box: Optional[List[float]] = None
    ) -> Tuple[Optional[np.ndarray], Dict[str, Any]]:
        """
        Extracts the cadastral parcel boundary from an uploaded red book photo.
        Automatically separates:
          1. Left page (Trang 2 - Pháp lý & thuộc tính thửa đất).
          2. Right page (Trang 3 - Sơ đồ hình thể thửa đất trung tâm).
          3. Table column (Trang 3 - Bảng kê tọa độ / chiều dài cạnh bên phải) -> chuyển sang AI đồ họa phục chế.
        """
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            return None, {"error": "Không thể giải mã hình ảnh"}

        h, w = img.shape[:2]
        crop_offset_x = 0
        crop_offset_y = 0

        # If user specified an ROI bounding box [xmin, ymin, xmax, ymax]
        if roi_box and len(roi_box) == 4:
            try:
                rx1, ry1, rx2, ry2 = roi_box
                # Normalize if fractions (0.0 to 1.0)
                if rx2 <= 1.0 and ry2 <= 1.0 and rx1 <= 1.0 and ry1 <= 1.0:
                    rx1, rx2 = int(rx1 * w), int(rx2 * w)
                    ry1, ry2 = int(ry1 * h), int(ry2 * h)
                else:
                    rx1, ry1, rx2, ry2 = int(rx1), int(ry1), int(rx2), int(ry2)

                rx1 = max(0, min(w - 10, rx1))
                ry1 = max(0, min(h - 10, ry1))
                rx2 = max(rx1 + 10, min(w, rx2))
                ry2 = max(ry1 + 10, min(h, ry2))

                img_roi = img[ry1:ry2, rx1:rx2]
                if img_roi.size > 0:
                    crop_offset_x = rx1
                    crop_offset_y = ry1
                    img_for_contour = img_roi
                else:
                    img_for_contour = img
            except Exception:
                img_for_contour = img
        else:
            # Auto-detect two-page spread (w / h > 1.15): parcel sketch is located on the right page
            aspect = w / max(h, 1)
            if aspect > 1.15:
                crop_offset_x = int(w * 0.46)
                img_for_contour = img[:, crop_offset_x:]
            else:
                img_for_contour = img

        ch, cw = img_for_contour.shape[:2]
        gray = cv2.cvtColor(img_for_contour, cv2.COLOR_BGR2GRAY)
        
        # Bilateral / Gaussian filter to keep sharp parcel boundary lines while smoothing paper noise
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)
        
        # Adaptive thresholding
        thresh = cv2.adaptiveThreshold(
            blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 15, 4
        )

        # Morphological closing
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        closed = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel, iterations=1)

        # Find contours with tree hierarchy
        contours, hierarchy = cv2.findContours(closed, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
        
        if not contours:
            return None, {"error": "Không tìm thấy đường bao thửa đất"}

        img_area = cw * ch
        scored_candidates = []
        detected_table_box = None

        for cnt in contours:
            area = cv2.contourArea(cnt)
            # Filter noise and huge outer page borders
            if area < 0.003 * img_area or area > 0.85 * img_area:
                continue

            peri = cv2.arcLength(cnt, True)
            approx = cv2.approxPolyDP(cnt, 0.02 * peri, True)
            rect = cv2.minAreaRect(cnt)
            rw, rh = rect[1]
            if rw < 10 or rh < 10:
                continue

            rect_area = max(rw * rh, 1.0)
            rectangularity = area / rect_area

            bx, by, bw, bh = cv2.boundingRect(cnt)
            center_x = bx + bw / 2.0
            center_y = by + bh / 2.0

            # Detect table frames vs irregular parcel polygon:
            # 1. Vertical column table on the right side:
            is_vert_table = (rectangularity > 0.70 and bh > 1.05 * bw and center_x > cw * 0.48)
            # 2. Bottom horizontal table:
            is_horiz_table = (rectangularity > 0.82 and bw > 1.2 * bh and center_y > ch * 0.55)
            # 3. Axis-aligned bounding box:
            is_box = (rectangularity > 0.84 and len(approx) == 4)
            is_table = is_vert_table or is_horiz_table or is_box

            # Track the cadastral table / coordinate table:
            if is_vert_table and center_y < ch * 0.52:
                if detected_table_box is None or (bw * bh) > (detected_table_box[2] * detected_table_box[3]):
                    detected_table_box = (bx + crop_offset_x, by + crop_offset_y, bw, bh)

            # Score this contour
            score = area
            if is_table:
                score *= 0.0001  # Exclude tables from parcel candidates
            else:
                # Highly reward genuine cadastral parcel shapes (4 to 25 vertices, irregular)
                if 4 <= len(approx) <= 25:
                    score *= 8.0
                if center_y < ch * 0.65:
                    score *= 4.0
                if center_x < cw * 0.75:
                    score *= 2.5
                if rectangularity < 0.80:
                    score *= 2.0

            scored_candidates.append({
                "score": score,
                "area": area,
                "is_table": is_table,
                "rectangularity": rectangularity,
                "vertex_count": len(approx),
                "approx": approx,
                "contour": cnt,
                "bbox": [bx + crop_offset_x, by + crop_offset_y, bw, bh]
            })

        if not scored_candidates:
            # Fallback to largest
            largest_cnt = max(contours, key=cv2.contourArea)
            peri = cv2.arcLength(largest_cnt, True)
            approx = cv2.approxPolyDP(largest_cnt, 0.02 * peri, True)
        else:
            scored_candidates.sort(key=lambda x: x["score"], reverse=True)
            approx = scored_candidates[0]["approx"]

        # Shift approx back if offset was used
        if crop_offset_x > 0 or crop_offset_y > 0:
            approx[:, :, 0] += crop_offset_x
            approx[:, :, 1] += crop_offset_y

        peri = cv2.arcLength(approx, True)

        # Generate debug preview image with contour drawn
        preview_img = img.copy()
        cv2.drawContours(preview_img, [approx], -1, (0, 255, 0), 3)
        for pt in approx:
            cv2.circle(preview_img, tuple(pt[0]), 5, (0, 0, 255), -1)

        # Draw ROI box if used
        if roi_box and len(roi_box) == 4:
            cv2.rectangle(preview_img, (crop_offset_x, crop_offset_y), 
                          (crop_offset_x + cw, crop_offset_y + ch), (255, 200, 0), 2)

        # Draw Cyan box if table was detected and label it
        table_meta = {"table_detected": False}
        if detected_table_box is not None:
            tx, ty, tw_box, th_box = detected_table_box
            cv2.rectangle(preview_img, (tx, ty), (tx + tw_box, ty + th_box), (255, 230, 0), 2)
            cv2.putText(preview_img, "BANG KE (AI PHUC CHE)", (tx, max(20, ty - 6)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 230, 0), 1)

            # Crop the table with a slight padding and run AI Graphics Restoration Pipeline
            pad_x = max(5, int(tw_box * 0.05))
            pad_y = max(5, int(th_box * 0.05))
            x1 = max(0, tx - pad_x)
            y1 = max(0, ty - pad_y)
            x2 = min(w, tx + tw_box + pad_x)
            y2 = min(h, ty + th_box + pad_y)
            table_bgr = img[y1:y2, x1:x2]

            _, _, table_meta = restore_cadastral_table_image(table_bgr)

        _, buffer = cv2.imencode('.jpg', preview_img)
        preview_b64 = base64.b64encode(buffer).decode('utf-8')

        meta = {
            "vertex_count": len(approx),
            "perimeter": round(float(peri), 1),
            "area_px": round(float(cv2.contourArea(approx)), 1),
            "preview_base64": f"data:image/jpeg;base64,{preview_b64}",
            "candidates_count": len(scored_candidates),
            "table_detected": table_meta.get("table_detected", False),
            "table_type": table_meta.get("table_type", "Không có bảng số"),
            "restored_table_preview": table_meta.get("restored_preview", ""),
            "binary_table_preview": table_meta.get("binary_preview", ""),
            "table_text": table_meta.get("table_text", ""),
            "table_edge_list": table_meta.get("edge_list", []),
            "is_coord_table": table_meta.get("is_coord_table", False)
        }

        return approx, meta

    def compute_similarity(self, cnt1: np.ndarray, cnt2: np.ndarray) -> float:
        """
        Computes comprehensive geometric similarity (0% - 100%) between two contours.
        
        UPGRADED 6-algorithm ensemble specifically tuned for Vietnamese cadastral parcel shapes:
          1. Partial Edge Signature (30%) - Handles split/merged parcels via partial matching
          2. Turn Angle Sequence (20%) - Discriminative for irregular corner structures
          3. Hausdorff Distance (20%)  - Boundary shape fidelity
          4. Hu Moments I1 (15%)       - Global shape descriptor
          5. Edge Length Distribution (10%) - Characteristic edge ratios
          6. Aspect Ratio (5%)         - Coarse overall shape sanity check
        """
        try:
            pts1 = _polygon_pts(cnt1)
            pts2 = _polygon_pts(cnt2)

            if len(pts1) < 3 or len(pts2) < 3:
                return 50.0

            # --- 1. Hu Moments I1 (global shape) ---
            hu_dist = cv2.matchShapes(cnt1, cnt2, cv2.CONTOURS_MATCH_I1, 0.0)
            # Cadastral polygons: dist < 0.15 = very similar, > 0.55 = very different
            hu_score = max(0.0, 100.0 * (1.0 - min(hu_dist / 0.55, 1.0)))

            # --- 2. Turn Angle Sequence (corner-sensitive for cadastral shapes) ---
            ta_score = _turn_angle_similarity(pts1, pts2, n_pts=48)

            # --- 3. Hausdorff Distance (boundary fidelity) ---
            hd_score = _hausdorff_similarity(pts1, pts2, n_pts=64)

            # --- 4. Edge Length Distribution ---
            el_score = _edge_length_similarity(pts1, pts2)

            # --- 5. Aspect Ratio ---
            rect1 = cv2.minAreaRect(cnt1)
            rect2 = cv2.minAreaRect(cnt2)
            w1, h1 = rect1[1]
            w2, h2 = rect2[1]
            if w1 > 0 and h1 > 0 and w2 > 0 and h2 > 0:
                ar1 = max(w1, h1) / max(min(w1, h1), 1e-5)
                ar2 = max(w2, h2) / max(min(w2, h2), 1e-5)
                ar_score = max(0.0, 100.0 * (1.0 - min(abs(ar1 - ar2) / max(ar1, ar2, 1e-5), 1.0)))
            else:
                ar_score = 50.0

            # --- 6. Partial Edge Signature (Handles Split/Merged) ---
            partial_score = _partial_edge_signature_similarity(pts1, pts2)

            # --- Ensemble: weighted combination ---
            final_score = (
                0.30 * partial_score + # Partial match (most important for split plots)
                0.20 * ta_score +      # Turn angle sequence
                0.20 * hd_score +      # Hausdorff boundary distance
                0.15 * hu_score +      # Hu Moments global descriptor
                0.10 * el_score +      # Edge length distribution
                0.05 * ar_score        # Aspect ratio (coarse check)
            )

            return round(min(100.0, max(0.0, final_score)), 1)

        except Exception:
            return 50.0

    def match_against_database(self, query_contour: np.ndarray, candidate_plots: List[Dict[str, Any]], 
                               filter_area_ha: Optional[float] = None, 
                               area_tolerance: float = 0.25) -> List[Dict[str, Any]]:
        """
        Matches query contour against a list of candidate forest plots.
        Ranks by similarity score and returns Top results.
        """
        results = []

        for plot in candidate_plots:
            # Area filter pruning if provided
            if filter_area_ha is not None and filter_area_ha > 0:
                p_area = plot["area_ha"]
                min_a = filter_area_ha * (1 - area_tolerance)
                max_a = filter_area_ha * (1 + area_tolerance)
                if not (min_a <= p_area <= max_a):
                    continue

            # Convert plot geometry to normalized contour
            plot_contour = self.polygon_to_contour(plot["coordinates"])
            score = self.compute_similarity(query_contour, plot_contour)

            # Area bonus if close
            if filter_area_ha is not None and filter_area_ha > 0:
                area_ratio = min(plot["area_ha"], filter_area_ha) / max(plot["area_ha"], filter_area_ha)
                score = round(0.75 * score + 0.25 * (area_ratio * 100), 1)

            results.append({
                "plot_id": plot["id"],
                "owner_name": plot["owner_name"],
                "province": plot["province"],
                "district": plot["district"],
                "commune": plot["commune"],
                "area_ha": plot["area_ha"],
                "tree_species": plot["tree_species"],
                "fm_status": plot["fm_status"],
                "sbp_status": plot["sbp_status"],
                "redbook_no": plot["redbook_no"],
                "shape_type": plot["shape_type"],
                "similarity_score": score,
                "coordinates": plot["coordinates"],
                "centroid": plot["centroid"]
            })

        # Sort descending by similarity score
        results.sort(key=lambda x: x["similarity_score"], reverse=True)
        return results[:8]

# Singleton instance
shape_matcher_engine = ShapeMatcher()
