# Nguồn ứng dụng

Ứng dụng được nhập từ `WebGIS_PhuTai_CentralVietnam_Package.zip` do người dùng cung cấp.

- SHA-256 gói gốc: `7044f948b8d13347d289e160068bc6df73da19a836f8b2f83f67733ab9780d7d`.
- Gói gốc có 110 mục; được giữ nguyên ngoài checkout tại máy thiết lập.
- Mã mẫu GIS Workspace trước đó đã được thay thế. Có thể xem lại nó trong lịch sử Git tại commit `b7758e4`.
- Giữ giao diện, logo, MapLibre, backend và các module nghiệp vụ Phú Tài.
- Điều chỉnh để triển khai: cấu hình qua môi trường, khóa phiên bản Python dependencies, Python/Uvicorn thường trực trên Plesk không Docker, Docker tùy chọn cho host khác, đăng nhập cho dữ liệu khi host, hạn chế tải file riêng và kiểm tra runtime.
- `.env`, tài khoản/phiên đăng nhập, hồ sơ sổ đỏ, dữ liệu chủ rừng và ảnh chụp màn hình được giữ riêng; không đưa lên repository công khai hoặc image Docker.
- Tài liệu hướng dẫn đi kèm gói chỉ là tài liệu tham khảo. Cấu hình hiện hành nằm trong [README](../README.md) và [hướng dẫn không Docker](DEPLOY_NO_DOCKER.md); [phương án Docker](DEPLOY_PLESK.md) chỉ dành cho máy chủ hỗ trợ.

Giới hạn dữ liệu gốc: lớp `layer_f3f5750f` chỉ có chỉ mục; gói không có GeoJSON/SQLite đầy đủ của lớp này. Bộ MapInfo thiếu `.MAP` và `.DAT`. Không tạo dữ liệu giả để thay thế.
