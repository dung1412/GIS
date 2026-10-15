> Tài liệu tham khảo đi kèm gói nguồn. Cấu hình hiện hành xem README.md và DEPLOY_PLESK.md.

# TÀI LIỆU BÀN GIAO KỸ THUẬT & HƯỚNG DẪN DỰ ÁN CHO AI CODEX
**Dự án**: Hệ Thống WebGIS Quản Lý Lâm Nghiệp, Rừng Trồng & So Khớp Sổ Đỏ (Phú Tài Bioenergy)
**Địa bàn áp dụng**: 3 tỉnh miền Trung Việt Nam (Quảng Ngãi, Bình Định, Phú Yên)

---

## 1. Mục Đích & Bối Cảnh Hệ Thống
Hệ thống WebGIS phục vụ công ty Cổ phần Năng lượng Sinh học Phú Tài (Phú Tài Bioenergy) nhằm:
1. **Quản lý ranh giới & lô rừng**: Quản lý hơn 308.000 thửa rừng trồng trên địa bàn 3 tỉnh miền Trung.
2. **So khớp hình thể sổ đỏ (Red Book Shape Matching)**:
   - Trích xuất tọa độ VN-2000 hoặc hình học từ ảnh chụp Giấy chứng nhận quyền sử dụng đất (Sổ đỏ).
   - Tự động chuyển đổi sang WGS-84, tính độ tương đồng hình học (IoU, Hausdorff, Fourier descriptors) với các lô rừng trong cơ sở dữ liệu.
3. **Giám sát chứng chỉ rừng & EUDR**:
   - Kiểm tra tuân thủ EUDR (mốc ngày 31/12/2020) chống mất rừng.
   - Giám sát chứng chỉ FM (Forest Management) và SBP (Sustainable Biomass Program).
   - Tích hợp ảnh vệ tinh Sentinel-2 (Copernicus API) và Planet Labs.

---

## 2. Kiến Trúc Kỹ Thuật

### 2.1. Backend (Python + FastAPI)
* **Framework**: FastAPI + Uvicorn
* **Tệp khởi chạy chính**: `run_app.py` (cấu hình Windows Selector Event Loop để khắc phục lỗi WinError 64, tự động phát hiện PROJ/GDAL).
* **Các module cốt lõi** (`backend/`):
  * `app.py`: REST API endpoints (quản lý lớp bản đồ, tìm kiếm thửa đất, tải GeoJSON, xuất ảnh raster, xác thực EUDR).
  * `gis_engine.py`: Chuyển đổi tọa độ VN-2000 (KTT 108°00' Quảng Ngãi, 108°15' Bình Định, 108°30' Phú Yên) sang WGS-84 (EPSG:4326) và ngược lại.
  * `shape_matcher.py`: Thuật toán so khớp hình thể thửa đất với sổ đỏ.
  * `redbook_vision_parser.py` & `redbook_ocr.py`: OCR tiếng Việt, nhận diện bảng tọa độ VN-2000 từ ảnh sổ đỏ.
  * `eudr_compliance.py`: Phân tích rủi ro mất rừng từ ảnh vệ tinh Sentinel-2 / JRC GFC.
  * `copernicus_engine.py`: Truy vấn và tải ảnh Sentinel-2 L2A qua Copernicus Data Space API.
  * `layer_manager.py`: Quản lý danh mục lớp bản đồ (`data/layers_catalog.json`).

### 2.2. Frontend (MapLibre GL JS + Vanilla HTML/CSS/JS)
* **Thư mục**: `frontend/`
* **Thư viện bản đồ**: MapLibre GL JS v3+
* **Các controller chính**:
  * `frontend/js/map_controller.js`: Điều khiển MapLibre, tải các lớp vector, MBTiles, ranh giới tỉnh, streaming viewport BBOX.
  * `frontend/js/app.js`: Quản lý giao diện, sự kiện người dùng, tabs (Chủ rừng, Thửa đất, So khớp, Khảo sát, Xuất bản đồ).
  * `frontend/js/shape_matcher_ui.js`: Giao diện tương tác tải ảnh sổ đỏ và đối soát hình thể.
  * `frontend/js/field_survey.js`: Biểu mẫu khảo sát thực địa với định vị GPS & camera đóng dấu mộc.

### 2.3. Ranh Giới Hành Chính 3 Tỉnh (Province Boundaries)
* Dữ liệu: `data/provinces_boundaries.geojson` (Polygons & Labels) và `data/provinces_boundaries_lines.geojson` (Dedicated boundary lines).
* Mã tỉnh:
  * `QNG`: Quảng Ngãi (KTT 108.0)
  * `BDH`: Bình Định (KTT 108.25)
  * `PYE`: Phú Yên (KTT 108.5)
* Bộ điều khiển:
  * `highlightProvince(provCode)`: Chuyển đổi highlight và fitBounds về tỉnh tương ứng hoặc cả 3 tỉnh (`ALL`).
  * `bringBoundariesToFront()`: Giữ các đường ranh giới và nhãn tỉnh luôn nổi lên trên các lớp lô rừng chi tiết.
  * `toggleProvinceBoundaries(visible)`: Nút bật/tắt ranh giới hành chính từ dropdown header.

---

## 3. Cách Cài Đặt & Chạy Hệ Thống

### 3.1. Chạy trên Windows (Khuyến nghị):
Nhấp đúp chuột vào file:
```bat
CHAY_HE_THONG.bat
```
File này sẽ tự động tìm Python từ QGIS hoặc Python hệ thống, nạp các biến môi trường GDAL/PROJ, khởi động FastAPI server tại `http://127.0.0.1:8000` và mở trình duyệt web.

### 3.2. Chạy thủ công bằng Terminal:
```bash
pip install -r requirements.txt
python run_app.py
```
Mở trình duyệt truy cập: `http://localhost:8000`

### 3.3. Tài khoản đăng nhập kiểm thử:

---

## 4. Ghi Chú Dành Cho Codex / Developer
1. Dữ liệu lớn SQLite (`data/layers/layer_f3f5750f.sqlite`, ~1.4GB chứa 308k lô rừng) được tách riêng để giảm dung lượng file nén. Hệ thống có sẵn file tổng quan `layer_f3f5750f_overview.geojson` và `layer_f3f5750f_index.json` để chạy mượt mà ngay lập tức.
2. Hệ tọa độ VN-2000 tại Việt Nam sử dụng kinh tuyến trục riêng cho từng tỉnh (3 độ), khi tính toán cần lưu ý tham số KTT tương ứng.
