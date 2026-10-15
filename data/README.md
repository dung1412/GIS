# Dữ liệu vận hành riêng

Dữ liệu rừng, sổ đỏ, tài khoản và phiên đăng nhập từ gói nguồn được giữ ở máy hiện tại và không đưa lên Git công khai. Các thư mục `layers/`, `source_tab/`, `user_layers/`, cơ sở dữ liệu `webgis.db`, nhật ký sổ đỏ, GeoJSON thử nghiệm và workbook phải được chuyển riêng qua kênh quản trị an toàn nếu triển khai lên máy chủ.

Repository chỉ chứa ranh giới tỉnh và glyph fonts cần cho giao diện. Không bật phục vụ HTTP toàn bộ thư mục data.

Gói tải lên thiếu GeoJSON/SQLite đầy đủ cho lớp có mã `layer_f3f5750f`; chỉ có chỉ mục. Bộ MapInfo cũng thiếu `.MAP` và `.DAT`, nên không thể phục hồi lớp này chỉ từ những file hiện có.
