"""
Module: redbook_vision_parser
Handles image preprocessing (deskew, auto-rotate, crop) and utilizes Gemini 3.1 Pro (Vision)
via REST API to extract structured cadastral data from Red Book (Sổ đỏ) images.
"""

import cv2
import numpy as np
import base64
import json
import os
import requests
from typing import Dict, Any, Tuple, List, Optional

class DocumentParser:
    def __init__(self):
        # Expects GEMINI_API_KEY in environment or .env
        try:
            from config import cloud_config
        except ImportError:
            pass
        self.api_key = os.environ.get("GEMINI_API_KEY", "")
        self.api_url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent"

    def preprocess_image(self, image_bytes: bytes) -> Tuple[np.ndarray, np.ndarray, np.ndarray, Dict[str, Any]]:
        """
        Auto-deskew, rotate, and crop the image into:
        1. Owner Info Region (Trang 2)
        2. Parcel Sketch Region (Trang 3)
        Returns: (original_img, owner_img, sketch_img, meta_data)
        """
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("Không thể giải mã hình ảnh.")

        # 1. Deskew
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(gray, (9, 9), 0)
        thresh = cv2.adaptiveThreshold(blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 11, 2)
        
        coords = np.column_stack(np.where(thresh > 0))
        if len(coords) > 0:
            angle = cv2.minAreaRect(coords)[-1]
            if angle < -45:
                angle = -(90 + angle)
            else:
                angle = -angle
            
            if abs(angle) > 0.5:
                (h, w) = img.shape[:2]
                center = (w // 2, h // 2)
                M = cv2.getRotationMatrix2D(center, angle, 1.0)
                img = cv2.warpAffine(img, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
        
        h, w = img.shape[:2]
        
        # 2. Crop Regions
        aspect = w / max(h, 1)
        if aspect > 1.15:
            # Two pages side-by-side
            mid = w // 2
            owner_img = img[:, :mid]
            sketch_img = img[:, mid:]
            is_spread = True
        else:
            owner_img = img
            sketch_img = img
            is_spread = False

        meta = {
            "deskew_angle": round(angle if 'angle' in locals() else 0, 2),
            "is_spread": is_spread,
            "original_width": w,
            "original_height": h
        }
        
        return img, owner_img, sketch_img, meta

    def _img_to_base64(self, img: np.ndarray) -> str:
        """Converts OpenCV image to base64 string."""
        _, buffer = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 85])
        return base64.b64encode(buffer).decode('utf-8')

    def extract_parcel_data(self, owner_img: np.ndarray, sketch_img: np.ndarray) -> Dict[str, Any]:
        """
        Uses Gemini 1.5/3.1 Pro REST API to extract structured data.
        """
        if not self.api_key:
            return {"error": "API Key missing", "status": "failed"}

        prompt = """
        Đây là ảnh Sổ đỏ (Giấy chứng nhận quyền sử dụng đất). Ảnh thứ nhất thường chứa thông tin pháp lý (chủ rừng, địa chỉ). Ảnh thứ hai thường chứa sơ đồ hình thể.
        Hãy trích xuất các thông tin sau và định dạng chính xác theo JSON format:
        {
            "owner_name": {"value": "...", "confidence": "high|medium|low", "status": "confirmed|uncertain|unreadable"},
            "district": {"value": "...", "confidence": "high|medium|low", "status": "confirmed|uncertain|unreadable"},
            "commune": {"value": "...", "confidence": "high|medium|low", "status": "confirmed|uncertain|unreadable"},
            "sheet_no": {"value": "...", "confidence": "high|medium|low", "status": "confirmed|uncertain|unreadable"},
            "parcel_no": {"value": "...", "confidence": "high|medium|low", "status": "confirmed|uncertain|unreadable"},
            "area_m2": {"value": 0.0, "confidence": "high|medium|low", "status": "confirmed|uncertain|unreadable"},
            "land_use_purpose": {"value": "...", "confidence": "high|medium|low", "status": "confirmed|uncertain|unreadable"},
            "adjacent_neighbors": [{"label": "...", "location": "north|south|east|west"}],
            "edge_lengths_meters": [{"edge_id": "...", "length": 0.0}],
            "parcel_shape_vertices": [{"vertex_id": "1", "x": 0, "y": 0}]
        }
        Lưu ý đối với parcel_shape_vertices: Dựa vào hình vẽ sơ đồ thửa đất, hãy xác định toạ độ (x, y) chuẩn hoá (từ 0 đến 1000) của các đỉnh góc thửa đất (thường được đánh số 1, 2, 3...) theo đúng thứ tự chu vi của hình vẽ.
        Lưu ý đối với edge_lengths_meters: Nếu không có bảng kê chiều dài cạnh, hãy tìm con số chiều dài được ghi trực tiếp trên các đoạn thẳng (cạnh) của sơ đồ hình thể để điền vào.
        Trả về đúng định dạng JSON, không kèm markdown code blocks (như ```json).
        """

        owner_b64 = self._img_to_base64(owner_img)
        sketch_b64 = self._img_to_base64(sketch_img)

        payload = {
            "contents": [
                {
                    "parts": [
                        {"inline_data": {"mime_type": "image/jpeg", "data": owner_b64}},
                        {"inline_data": {"mime_type": "image/jpeg", "data": sketch_b64}},
                        {"text": prompt}
                    ]
                }
            ],
            "generationConfig": {
                "temperature": 0.1,
                "responseMimeType": "application/json"
            }
        }

        try:
            url = f"{self.api_url}?key={self.api_key}"
            headers = {'Content-Type': 'application/json'}
            response = requests.post(url, json=payload, headers=headers)
            response.raise_for_status()
            
            data = response.json()
            text_result = data['candidates'][0]['content']['parts'][0]['text']
            
            if text_result.startswith("```json"):
                text_result = text_result[7:]
            if text_result.endswith("```"):
                text_result = text_result[:-3]
                
            return json.loads(text_result.strip())
        except Exception as e:
            print(f"Vision API Error: {e}")
            if isinstance(e, requests.exceptions.HTTPError):
                print(f"Response: {e.response.text}")
            return {"error": str(e), "status": "failed"}

# Singleton
document_parser = DocumentParser()
