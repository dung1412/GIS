# GIS Workspace

Ứng dụng GIS chạy trong trình duyệt, dùng Leaflet để xem và quản lý một bộ dữ liệu GeoJSON nhỏ. Giao diện tiếng Việt có danh sách đối tượng, tìm kiếm không phân biệt dấu, bộ lọc điểm/đường/vùng, xem chi tiết trên bản đồ, thêm điểm bằng chuột, nhập và xuất GeoJSON.

Dữ liệu mẫu mô tả một số địa điểm tại TP. Hồ Chí Minh. Các tuyến và ranh giới chỉ để minh họa giao diện, không phải dữ liệu địa chính chính thức và không dùng để dẫn đường.

## Chạy trên máy hoặc môi trường đám mây

Cần Node.js **22.12 trở lên** và npm. Dùng Node.js phiên bản LTS tương thích khi có thể.

```sh
npm ci
npm run dev
```

Vite lắng nghe trên `0.0.0.0`, mặc định cổng `5173`. Trên máy cá nhân, mở địa chỉ được Vite hiển thị. Trong phiên thiết lập môi trường đám mây này, ứng dụng được kiểm tra bằng yêu cầu nội bộ; giao diện onboarding không cung cấp bản xem trước web. Nếu cổng đang được dùng, xem số cổng thực tế trong đầu ra của lệnh.

```sh
npm run build
npm test
npm run test:smoke
```

`build` tạo ứng dụng tĩnh trong `dist/`. `test` kiểm tra chuẩn hóa GeoJSON, hình học, giới hạn và dữ liệu mẫu bằng Node.js. `test:smoke` chạy 8 kiểm tra ứng dụng trong Chromium bằng Playwright và tự khởi động/dừng máy chủ riêng ở cổng `4175`. Lệnh ưu tiên trình duyệt tại `/usr/bin/chromium`, có thể ghi đè bằng biến `CHROMIUM_PATH`. Trên máy khác chưa có Chromium, chạy `npx playwright install chromium` trước. Có thể xem bản build bằng `npm run preview`.

Nếu npm không thể ghi cache mặc định trong môi trường đám mây, dùng `npm --cache /workspace/.cache/npm ci` thay cho `npm ci`. Không cần chỉnh sửa lockfile.

## Sử dụng dữ liệu

- **Nhập GeoJSON** thay thế toàn bộ dữ liệu hiện tại sau khi tệp được kiểm tra thành công. Xuất bản sao trước khi nhập hoặc khôi phục dữ liệu mẫu nếu muốn giữ thay đổi.
- Nhận một `Feature` hoặc `FeatureCollection`, tối đa **5 MB** và **10.000 đối tượng**. Bộ dữ liệu rỗng được chấp nhận.
- Hỗ trợ `Point`, `MultiPoint`, `LineString`, `MultiLineString`, `Polygon`, `MultiPolygon`. Các kiểu khác, bao gồm `GeometryCollection` và hình học `null`, chưa được hỗ trợ.
- Tọa độ dùng **WGS84** theo thứ tự **[kinh độ, vĩ độ]**, có thể thêm độ cao ở phần tử thứ ba. Kinh độ trong khoảng ±180, vĩ độ trong khoảng ±90; mọi giá trị phải hữu hạn. Các vòng của đa giác cần khép kín.
- Thuộc tính `name` dùng làm tên hiển thị; `description` và `category` bổ sung phần mô tả và danh mục. Các thuộc tính JSON khác vẫn được giữ khi xuất. Chưa có công cụ vẽ đường, vẽ vùng hay chỉnh sửa thuộc tính.
- Nút **Thêm điểm** cho phép chọn một vị trí trên bản đồ. Nhấn Escape để hủy thao tác.
- **Xuất GeoJSON** tải toàn bộ bộ dữ liệu xuống thành `gis-data.geojson`, kể cả các đối tượng đang ẩn bởi bộ lọc hoặc tìm kiếm.

Ứng dụng lưu thay đổi vào **localStorage của trình duyệt hiện tại**. Dữ liệu gắn với trình duyệt và địa chỉ trang; xóa dữ liệu trang, đổi địa chỉ/cổng hoặc dùng chế độ riêng tư có thể làm mất dữ liệu đã lưu. Hãy xuất GeoJSON để sao lưu và chuyển sang máy khác. Nếu trình duyệt từ chối lưu, ứng dụng báo lỗi và dữ liệu trong phiên vẫn có thể xuất.

## Kết nối và phạm vi

Không cần API key hay biến môi trường bí mật. Cài đặt phụ thuộc cần kết nối npm. Bản đồ nền lấy ảnh từ `https://tile.openstreetmap.org` và cần Internet; dữ liệu bản đồ nền thuộc OpenStreetMap contributors theo phần ghi nguồn trên bản đồ. Có thể tắt bản đồ nền và tiếp tục xem các đối tượng GeoJSON khi ảnh nền không tải được.

Đây là ứng dụng phía trình duyệt: chưa có backend, tài khoản, làm việc nhóm hoặc lưu dữ liệu trên máy chủ. Máy chủ Vite chỉ phục vụ phát triển; triển khai ứng dụng bằng nội dung tĩnh trong `dist/` sau khi build.
