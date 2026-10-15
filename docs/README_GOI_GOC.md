# HỆ THỐNG WEB GIS & MOBILE APP QUẢN LÝ CHỦ RỪNG, SO KHỚP HÌNH THỂ SỔ ĐỎ VÀ GIÁM SÁT CHỨNG CHỈ FM / SBP
### (Phục vụ Chuỗi Cung Ứng Viên Nén Gỗ Sinh Khối: Quảng Ngãi – Bình Định – Phú Yên)

---

## 1. GIỚI THIỆU & MỤC TIÊU DỰ ÁN

Hệ thống được thiết kế chuyên biệt cho các doanh nghiệp sản xuất và xuất khẩu viên nén gỗ sinh khối (Wood Pellets) tại miền Trung Việt Nam, đáp ứng các tiêu chuẩn chứng chỉ quốc tế khắt khe:
- **FSC-FM / PEFC-FM**: Quản lý rừng bền vững, kiểm soát ranh giới từng thửa/lô rừng trồng (keo, bạch đàn), đảm bảo tính hợp pháp của đất rừng.
- **SBP (Sustainable Biomass Program)**: Đánh giá rủi ro nguồn cung (SBE), xác minh nguồn sinh khối hợp pháp và tính toán phát thải nhà kính (GHG).
- **EUDR (Quy định Chống mất rừng của EU)**: Bắt buộc cung cấp tọa độ định vị (Geolocation Polygon) cho từng lô rừng thu hoạch, chứng minh không gây suy thoái rừng sau ngày 31/12/2020.

---

## 2. CÁC TÍNH NĂNG NỔI BẬT

### 2.1. Bản đồ GIS Đa nền Đại trà (Basemaps) & Vệ Tinh Chuyên Dụng Lâm Nghiệp
- Tích hợp động các lớp bản đồ nền quen thuộc và chuẩn xác nhất:
  - **🛰️ Planet Labs Vệ Tinh Rừng Mới Nhất (08/2026)**: Ảnh viễn thám độ phân giải cao 3m chuyên dụng cho rừng nhiệt đới của Planet NICFI.
  - **🌲 Planet Labs Mốc Chống Phá Rừng EUDR (31/12/2020)**: Bản đồ vệ tinh lịch sử dùng làm căn cứ pháp lý thẩm định không suy thoái rừng theo chuẩn EUDR.
  - **Google Maps Satellite & Hybrid (Chính thức)**: Ảnh vệ tinh chi tiết + địa danh/giao thông tích hợp khóa Google Cloud Project `sturdy-tenure-244607`.
  - **Esri World Imagery**: Ảnh viễn thám độ nét cao toàn cầu.
  - **OpenStreetMap & OpenTopoMap**: Bản đồ giao thông, ranh giới hành chính và đường bình độ độ dốc phục vụ quy hoạch khai thác gỗ.
- Thanh trượt điều chỉnh độ trong suốt (Opacity slider) từ 0% đến 100% giúp đối chiếu ranh giới quy hoạch lô với hiện trạng thực tế từ tán cây vệ tinh.
- Hiển thị tọa độ kép thời gian thực: Hệ tọa độ quốc tế **WGS-84** và Hệ tọa độ quốc gia **VN-2000** (theo kinh tuyến trục của từng tỉnh).

### 2.2. Tra cứu & Quản lý Chủ rừng Toàn diện
- Tìm kiếm tức thời (live search) theo:
  - Họ và tên chủ rừng
  - Số CMND/CCCD hoặc Số điện thoại
  - Mã lô, số khoảnh, tiểu khu
  - Số hiệu Sổ đỏ (GCNQSDĐ)
- Lọc theo Tỉnh (Quảng Ngãi, Bình Định, Phú Yên) và Trạng thái chứng chỉ (FM/SBP Certified, Controlled, High Risk).
- Tự động tính toán ước tính sản lượng sinh khối dăm gỗ/viên nén (tấn/ha).

### 2.3. Module Độc quyền: "So Khớp Hình Thể Sổ Đỏ" (Shape Similarity Matching)
- **Tải ảnh chụp sơ đồ thửa đất**: Người dùng tải ảnh chụp sổ đỏ lên hệ thống.
- **AI Thị giác máy tính (OpenCV)**:
  - Tự động nắn góc, lọc nhiễu, phân đoạn nhị phân (adaptive thresholding) và trích xuất đường bao đa giác (Contour).
  - Rút gọn đa giác bằng thuật toán Douglas-Peucker.
  - Tính toán **7 Moment bất biến của Hu (Hu Moments)**, tỷ lệ khung bao (Aspect Ratio) và số đỉnh đa giác.
- **So khớp thông minh**: Lọc sơ bộ theo Xã + diện tích ($\pm 20\%$) và so sánh với toàn bộ các lô rừng trong cơ sở dữ liệu.
- **Trả về Top kết quả**: Hiển thị thanh tỷ lệ tương đồng (% Match), cho phép xem trước hình dạng và bay đến vị trí lô trên bản đồ chỉ bằng 1 cú nhấp chuột.
- **Bóc tách Bảng tọa độ VN-2000**: Hỗ trợ dán bảng danh sách tọa độ góc ranh (Điểm 1, 2, 3... X, Y), tự động chuyển đổi sang WGS-84 và khoanh vùng thửa đất chính xác 100%.

### 2.4. Chế độ Thực địa Đi rừng (Field Survey & Offline Mobile)
- **GPS Định vị Hiện trường**: Hiển thị vị trí thực tế của cán bộ với độ chính xác cao dưới tán rừng.
- **Cảnh báo Geofencing**: Tự động phát tín hiệu cảnh báo trực quan khi cán bộ di chuyển chệch ra ngoài ranh giới lô được cấp phép (ngăn chặn lấn chiếm rừng tự nhiên).
- **Chụp ảnh Đóng dấu Watermark Pháp lý**: Tự động dán Tọa độ GPS, Thời gian thực, Mã lô rừng và Tên cán bộ thẩm định cứng vào ảnh hiện trường.
- **Cơ chế Hoạt động Offline**: Toàn bộ biên bản khảo sát khi mất sóng 3G/4G được lưu an toàn vào bộ nhớ máy; tự động đồng bộ lên Server khi có mạng trở lại.

### 2.5. Xuất Gói Thẩm định Nguồn gốc EUDR
- Tự động xuất tệp GeoJSON đạt chuẩn thẩm định Due Diligence Statement (DDS) của Liên minh Châu Âu (EU), bao gồm mã HS 4401.31, tên khoa học cây trồng (*Acacia mangium / Acacia auriculiformis*), và tọa độ đa giác khép kín.

---

## 3. CẤU TRÚC THƯ MỤC DỰ ÁN

```
d:/Du an/
├── backend/
│   ├── app.py                 # Máy chủ FastAPI, cung cấp toàn bộ REST API và phục vụ Web
│   ├── gis_engine.py          # Quản lý CSDL không gian, tìm kiếm và chuyển đổi GeoJSON
│   ├── shape_matcher.py       # Engine thị giác máy tính OpenCV so khớp hình thể sổ đỏ
│   ├── redbook_ocr.py         # Module bóc tách tọa độ VN-2000 và sinh mẫu sơ đồ trích lục
│   └── eudr_compliance.py     # Đánh giá rủi ro SBP (SBE) và xuất gói dữ liệu EUDR DDS
├── frontend/
│   ├── index.html             # Giao diện Web App & Field Mobile GIS responsive
│   ├── css/
│   │   └── app.css            # Hệ thống thiết kế chuẩn hiện đại, dark mode lâm nghiệp, glassmorphism
│   └── js/
│       ├── map_controller.js  # Điều khiển bản đồ MapLibre GL JS, đổi basemap, popup, zoom
│       ├── shape_matcher_ui.js# Xử lý giao diện upload ảnh sổ đỏ và bảng tọa độ góc ranh
│       ├── field_survey.js    # Quản lý GPS thực địa, cảnh báo geofence, ảnh watermark và offline sync
│       └── app.js             # Điều phối chính, tìm kiếm đa tiêu chí, chuyển tỉnh, modal
├── run_app.py                 # File Python khởi chạy nhanh toàn bộ hệ thống
├── start_server.bat           # Phím tắt khởi động trên Windows chỉ bằng 1 cú nhấp đúp chuột
└── README.md                  # Tài liệu hướng dẫn sử dụng và triển khai
```

---

## 4. HƯỚNG DẪN KHỞI CHẠY VÀ SỬ DỤNG

### Cách 1: Khởi chạy bằng file Batch (Nhanh nhất trên Windows)
1. Nhấp đúp chuột vào file `start_server.bat`.
2. Mở trình duyệt web bất kỳ (Chrome, Edge, Firefox) và truy cập địa chỉ:
   ```
   http://127.0.0.1:8000
   ```

### Cách 2: Khởi chạy bằng dòng lệnh
```powershell
& "C:\Program Files\QGIS 3.44.11\apps\Python312\python.exe" run_app.py
```

---

## 5. HƯỚNG DẪN ĐƯA FILE BẢN ĐỒ (SHP / GEOJSON) LÊN HỆ THỐNG

Hệ thống cung cấp **2 cách** cực kỳ linh hoạt để bạn nạp file bản đồ 3 tỉnh (Quảng Ngãi, Bình Định, Phú Yên):

### Cách 1: Nạp trực tiếp trên Giao diện Web (Dễ nhất - Không cần gõ lệnh)
1. Mở ứng dụng web tại: `http://127.0.0.1:8000`.
2. Bấm vào nút màu xanh ở góc trên: **`📤 Nhập File Bản Đồ (SHP / GeoJSON)`**.
3. **Chuẩn bị file Shapefile**:
   - File Shapefile chuẩn luôn gồm ít nhất 4 tệp cùng tên: `.shp` (hình học), `.dbf` (bảng thông tin chủ rừng), `.shx` (chỉ mục), và `.prj` (hệ tọa độ).
   - Hãy **chọn cả 4 tệp này và nén lại thành 1 file `.ZIP`** (Ví dụ: `QuangNgai_RungKeo.zip`).
   - *(Hoặc nếu bạn có sẵn file định dạng `.GeoJSON`, bạn có thể dùng trực tiếp không cần nén).*
4. Chọn Tỉnh tương ứng (Quảng Ngãi, Bình Định, Phú Yên) để hệ thống tự động nhận diện Kinh tuyến trục VN-2000.
5. **Kéo thả file `.ZIP` vào ô tải lên**:
   - Hệ thống sẽ tự động giải nén, chuyển đổi tọa độ VN-2000 sang WGS-84, đọc tên chủ rừng, diện tích, loài cây và vẽ ngay lập tức lên bản đồ!

---

### Cách 2: Nạp hàng loạt bằng Dòng lệnh (Dành cho file SHP rất lớn)
Nếu file Shapefile của bạn có dung lượng hàng trăm Megabytes hoặc chứa hàng vạn lô rừng:
1. Copy file `.shp` và các file đi kèm (`.dbf`, `.shx`, `.prj`) vào thư mục `data/` trong thư mục dự án.
2. Mở PowerShell trong thư mục `d:\Du an` và chạy lệnh:
   ```powershell
   & "C:\Program Files\QGIS 3.44.11\apps\Python312\python.exe" import_shp.py "data/ten_file_cua_ban.shp" "Quảng Ngãi"
   ```
   *(Thay `"Quảng Ngãi"` bằng `"Bình Định"` hoặc `"Phú Yên"` tùy theo địa bàn của file).*
3. Toàn bộ dữ liệu sẽ được chuyển đổi và tích hợp thẳng vào hệ thống CSDL không gian của ứng dụng.

---

## 6. HƯỚNG DẪN ĐÓNG GÓI THÀNH APP ANDROID & IOS CHO CÁN BỘ ĐI RỪNG

Ứng dụng được thiết kế theo kiến trúc Web Responsive chuẩn Mobile-first. Để đóng gói thành file cài đặt APK (Android) hoặc IPA (iOS) cho cán bộ đi thực địa:

1. **Sử dụng Capacitor.js**:
   ```bash
   npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios
   npx cap init "ForestryGIS" "com.biomass.forestrygis" --web-dir "frontend"
   npx cap add android
   npx cap add ios
   npx cap copy
   ```
2. **Mở bằng Android Studio / Xcode**:
   ```bash
   npx cap open android
   ```
   Chọn **Build > Build Bundle(s) / APK(s) > Build APK(s)** để xuất file APK cài đặt trực tiếp vào điện thoại của cán bộ lâm trường.
