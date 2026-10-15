# Phú Tài Bioenergy — WebGIS miền Trung

Nguồn **WebGIS Phú Tài** được nhập từ `WebGIS_PhuTai_CentralVietnam_Package.zip` do người dùng cung cấp, thay thế bản GIS mẫu trước đó. Ứng dụng dùng FastAPI/Python, MapLibre và SQLite cho dữ liệu rừng Quảng Ngãi, Bình Định, Phú Yên. Xem [nguồn nhập và các điều chỉnh](docs/SOURCE_IMPORT.md).

Giữ giao diện, logo và các module của gói: bản đồ, tra cứu lô/chủ rừng, nhập GIS, công cụ VN-2000, so khớp hình thể, OCR, hồ sơ sổ đỏ và bản đồ cá nhân. Tích hợp vệ tinh/AI bên ngoài cần cấu hình và kết nối tương ứng; việc chạy server không xác nhận mọi dịch vụ ngoài đã hoạt động.

## Chạy bằng Python

Dùng **Python 3.12**. `requirements.lock` ghi phiên bản đã kiểm tra; `requirements.txt` giữ danh sách yêu cầu của gói gốc.

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.lock
```

Nếu chưa có `.env`, sao chép `.env.example` thành `.env`. Giữ nguyên file có sẵn; không commit giá trị bí mật.

```sh
.venv/bin/python -m backend.admin_cli
.venv/bin/python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
```

Lệnh tạo admin hỏi mật khẩu bằng nhập ẩn. Không tạo tài khoản demo mặc định. Giữ `WEBGIS_REQUIRE_AUTH=1`, `WEBGIS_ALLOW_REGISTRATION=0`, `WEBGIS_ENABLE_DEMO_ACCOUNTS=0` như `.env.example` khi host dữ liệu riêng. Bản triển khai mới cần cơ sở dữ liệu tài khoản mới; không chuyển cơ sở dữ liệu/phiên đăng nhập cũ từ gói tải lên.

Trong máy cloud hiện tại, dùng `python3` có sẵn để tạo venv; nếu cache mặc định không ghi được, thêm `--cache-dir /workspace/.cache/pip` vào lệnh pip.

Server phục vụ giao diện tại `/` và API tại `/api/`. `/api/health` cần trả `status: "ok"`. Onboarding không cung cấp web preview; kiểm tra tại đây bằng yêu cầu nội bộ và Chromium.

## Đưa lên Plesk

Máy chủ người dùng cung cấp: **15.235.180.82**, Plesk; hosting **không hỗ trợ Docker**. Người dùng xác nhận **`dung1412.online` đã hết hạn**. Không dùng `gis.dung1412.online` cho triển khai cho đến khi domain được gia hạn và DNS được kiểm tra. Cần chọn một domain khác còn hạn thuộc quyền quản lý, tên miền tạm do hosting cấp nếu có, hoặc gia hạn domain cũ. Website xuất hiện trong Plesk không xác nhận domain còn hạn; địa chỉ WebGIS hiện chưa được chốt.

Giao diện quản lý website/subscription và liên kết SSH Keys không chứng minh có quyền root, shell hay chạy dịch vụ Python thường trực. Cách triển khai phù hợp vẫn là nhờ nhà cung cấp chạy Python 3.12/Uvicorn bằng systemd và cấu hình nginx/HTTPS cho subdomain. Xem [hướng dẫn không dùng Docker và mẫu yêu cầu nhà cung cấp](docs/DEPLOY_NO_DOCKER.md). Chưa có kết nối quản trị máy chủ từ môi trường này; mã nguồn và hướng dẫn không xác nhận website đã online.

Backend chỉ nghe trên `127.0.0.1:8000`, Plesk/nginx phục vụ giao diện và API qua HTTPS. Dữ liệu lưu trong `data/`, `scratch/` ngoài document root; luồng SQLite hiện tại không cần PostGIS. Mục Python/Passenger của Plesk dùng WSGI không trực tiếp chạy FastAPI ASGI. [Hướng dẫn Docker](docs/DEPLOY_PLESK.md) chỉ áp dụng cho máy chủ khác có hỗ trợ container.

GitHub lưu nguồn có thể công khai. **GitHub Pages không chạy được backend Python**, nên cấu hình Pages của bản mẫu đã được thay bằng CI Python và cấu hình container. URL Pages cũ không phải nơi chạy đầy đủ hệ thống Phú Tài.

GPS/camera và sử dụng thực tế cần HTTPS với hostname/chứng chỉ phù hợp trên Plesk. Sau khi chọn địa chỉ hợp lệ, tạo website/subdomain với document root riêng. Với domain tự quản lý, tạo bản ghi `A` cho hostname đã chọn về `15.235.180.82` tại DNS có thẩm quyền nếu đây là máy chủ được nhà cung cấp xác nhận chạy WebGIS; với tên miền tạm, làm theo hướng dẫn của hosting. Giữ nguyên các website khác. Chỉ báo URL sử dụng sau khi kiểm tra DNS, backend, proxy và TLS thành công.

## Dữ liệu riêng

Dữ liệu chủ rừng, CCCD, điện thoại, sổ đỏ, tài khoản, phiên đăng nhập và khóa dịch vụ trong gói được giữ riêng tại máy thiết lập. `.gitignore` và `.dockerignore` loại chúng khỏi Git/image công khai. Chỉ chuyển dữ liệu nghiệp vụ cần thiết qua kênh quản trị an toàn; không đưa `webgis.db` có tài khoản/phiên cũ vào bản triển khai mới.

Nguồn công khai có ranh giới tỉnh, phông, logo và thư viện MapLibre. Xem [data/README.md](data/README.md). Gói có một lớp đầy đủ 31.332 đối tượng; lớp `layer_f3f5750f` chỉ có chỉ mục, thiếu GeoJSON/SQLite/overview. MapInfo thiếu `.MAP` và `.DAT`, nên cần bổ sung để dùng trọn lớp đó. Không tạo dữ liệu giả thay thế.

Các khóa Google/Planet/Gemini và thông tin Copernicus là tùy chọn, nhập trong `.env` riêng. Giá trị viết sẵn đã được bỏ. API công khai không trả khóa/phiên; đường dẫn tải trực tiếp cơ sở dữ liệu và hồ sơ riêng bị chặn.

## Kiểm tra

```sh
.venv/bin/python -m unittest discover -s tests -p 'test_*.py' -v
.venv/bin/python scripts/check_runtime.py
```

Unit tests dùng HTTP/SQLite tạm để kiểm tra đăng nhập, quyền sửa chung, quyền workspace, tạo admin và chặn file riêng. Không chạy kiểm tra ghi/xóa lên dữ liệu thật. `check_runtime.py` kiểm tra server đang chạy; đặt `WEBGIS_URL` để đổi địa chỉ và `WEBGIS_TOKEN` qua môi trường riêng khi cần đăng nhập. Thêm `--with-data` khi đã nạp dữ liệu để bắt buộc tra cứu có đối tượng.

Công cụ phát triển `tools/browser` dùng Chromium/Playwright để kiểm tra giao diện; Node không phải dependency của backend. Cài bằng `npm --prefix tools/browser ci`, rồi chạy `npm --prefix tools/browser test`. Ảnh nền/dịch vụ ngoài cần Internet, được ghi nhận riêng với kết quả API nội bộ.
