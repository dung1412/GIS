# Triển khai WebGIS Phú Tài trên Plesk không có Docker

Hosting `15.235.180.82` không hỗ trợ Docker. Ứng dụng cần **Python 3.12 + Uvicorn chạy thường trực**, nginx của Plesk chuyển tiếp đến `127.0.0.1:8000`. Chỉ bật Python/Passenger trong Plesk không đủ: Passenger Python thông thường dùng WSGI, còn FastAPI dùng ASGI. Không cần PostGIS.

Người dùng xác nhận **`dung1412.online` đã hết hạn**. Website còn xuất hiện trong Plesk không xác nhận domain còn hạn. Chưa chọn địa chỉ WebGIS; `gis.dung1412.online` chỉ dùng được sau khi gia hạn và kiểm tra DNS. Giữ nguyên các website hiện có.

Giao diện đang thấy quản lý website/subscription; liên kết **SSH Keys** không chứng minh shell đã bật, quyền root hay quyền chạy dịch vụ Python thường trực. **Các lệnh quản trị dưới đây dành cho nhà cung cấp hosting**, không giả định người dùng chạy được chúng. Ảnh không xác nhận hệ điều hành hoặc loại gói hosting.

## Chọn địa chỉ trước khi tạo website trong Plesk

1. Chọn domain khác còn hạn thuộc quyền quản lý, tên miền tạm do hosting cấp nếu hỗ trợ, hoặc gia hạn `dung1412.online`. Không suy ra các domain khác trong ảnh còn hạn hoặc được phép sử dụng. Tạo subdomain trong Plesk không gia hạn domain.
2. Sau khi xác nhận địa chỉ hợp lệ, tạo website riêng. Nếu dùng subdomain, vào **Websites & Domains → Add Subdomain**, nhập tên và chọn domain tương ứng. Nếu đã gia hạn domain cũ, có thể nhập `gis` và chọn `dung1412.online`. Dùng document root riêng do Plesk tạo, giữ nguyên thư mục các website hiện có.
3. Nhà cung cấp vẫn cần cài backend và proxy/HTTPS theo các phần dưới. Chưa upload ZIP/dữ liệu riêng vào document root.

Với domain tự quản lý, xác định DNS có thẩm quyền rồi thêm bản ghi **`A` cho hostname đã chọn → `15.235.180.82`** nếu nhà cung cấp xác nhận đây là máy chủ chạy WebGIS. DNS Settings của Plesk chỉ có hiệu lực nếu nameserver đang dùng phục vụ zone đó; nếu DNS đang ở nhà đăng ký/dịch vụ ngoài Plesk, thêm bản ghi tại đó. Với tên miền tạm, làm theo hướng dẫn DNS/HTTPS của hosting. Không thay bản ghi website khác. Địa chỉ chưa được coi là online trước khi DNS, backend, proxy và TLS cùng được kiểm tra.

## Gửi yêu cầu cho nhà cung cấp

> Tôi muốn chạy WebGIS Phú Tài trên hosting Plesk IP `15.235.180.82`, không dùng Docker. Domain `dung1412.online` đã hết hạn; xin cho biết có tên miền tạm hỗ trợ HTTPS để dùng hay không. Nếu không có, tôi cần chọn domain khác còn hạn hoặc gia hạn domain cũ trước khi chốt hostname. Xin giữ nguyên các website hiện có, xác nhận gói hosting cho phép dịch vụ Python 3.12/Uvicorn thường trực, rồi cài theo https://github.com/dung1412/GIS/blob/main/docs/DEPLOY_NO_DOCKER.md và unit `deploy/phutai-webgis.service`. Cần tài khoản hệ thống riêng, mã nguồn/dữ liệu ngoài document root, backend chỉ nghe localhost, nginx của website riêng và HTTPS. Tôi hiện thao tác qua giao diện quản lý website Plesk; chưa có kết nối SSH/root cho việc triển khai. Xin hỗ trợ kiểm tra địa chỉ, DNS tại nơi có thẩm quyền, backend/proxy và chứng chỉ. Vui lòng báo URL thực tế và kết quả kiểm tra sau khi cài.

Nếu nhà cung cấp không cho chạy dịch vụ Python thường trực, gói hosting này chưa đáp ứng backend. Cần gói khác cho phép ASGI; File Manager và GitHub Pages không thay thế khả năng này. Không gửi mật khẩu, khóa SSH hay API key trong chat.

## 1. Kiểm tra khả năng máy chủ

Nhà cung cấp kiểm tra Linux/systemd, Python 3.12, hạn mức CPU/RAM/dung lượng và cổng localhost `8000` chưa có dịch vụ khác. Trong môi trường đã kiểm tra, venv chiếm khoảng **796 MiB**, dữ liệu riêng khoảng **85 MiB**, frontend khoảng **31 MiB**; cần thêm chỗ cho cài đặt, lớp GIS mới và bản sao lưu. Ảnh Plesk hiển thị hạn mức **5 GB đã dùng khoảng 49%**; nhà cung cấp cần xác nhận dung lượng thực tế dành cho ứng dụng và quyền chạy dịch vụ. Các dependency đã kiểm tra trên Linux amd64/Python 3.12; với kiến trúc khác cần kiểm tra wheel tương ứng trước khi cài. Không thay Python hệ thống mà Plesk đang dùng.

Backend dùng wheel GIS trong `requirements.lock`; OpenCV còn cần thư viện GL/GLib/GOMP của hệ điều hành. Chỉ chạy lệnh phù hợp với bản phân phối đã xác nhận, qua kho chính thức:

| Hệ điều hành | Thư viện runtime |
| --- | --- |
| Debian 12 / Ubuntu 22.04 | `apt-get update` rồi `apt-get install --no-install-recommends ca-certificates libgl1 libglib2.0-0 libgomp1` |
| Debian 13 / Ubuntu 24.04 | `apt-get update` rồi `apt-get install --no-install-recommends ca-certificates libgl1 libglib2.0-0t64 libgomp1` |
| AlmaLinux / Rocky Linux 9 | `dnf install ca-certificates libglvnd-glx glib2 libgomp` |

Cài thêm Git và Python 3.12 có module venv/pip theo tài liệu chính thức của hệ điều hành nếu chưa có. Không tắt TLS/chữ ký gói khi xử lý lỗi cài đặt. Giữ các dịch vụ Plesk hiện có.

## 2. Cài mới vào thư mục riêng

Ví dụ dưới đây chạy trong shell quản trị **root của nhà cung cấp**, cho một bản cài mới. Nếu đã có thư mục, tài khoản, file môi trường hoặc unit cùng tên, dừng để kiểm tra/sao lưu; không ghi đè hay xóa chúng. Không upload ZIP vào `httpdocs`.

```bash
set -eu
test ! -e /opt/phutai-webgis
test ! -e /etc/phutai-webgis.env
test ! -e /etc/systemd/system/phutai-webgis.service
if getent passwd phutai-webgis >/dev/null || getent group phutai-webgis >/dev/null; then
    echo 'Đã có tài khoản/nhóm phutai-webgis; cần kiểm tra trước khi tiếp tục.' >&2
    exit 1
fi

useradd --system --user-group --no-create-home \
    --home-dir /opt/phutai-webgis --shell /usr/sbin/nologin phutai-webgis
git clone https://github.com/dung1412/GIS.git /opt/phutai-webgis
cd /opt/phutai-webgis
python3.12 -m venv .venv
.venv/bin/python -m pip install --requirement requirements.lock
.venv/bin/python -m pip check

chown -R root:phutai-webgis /opt/phutai-webgis
chmod -R u=rwX,g=rX,o= /opt/phutai-webgis
install -d -o phutai-webgis -g phutai-webgis -m 0750 data scratch
chown -R phutai-webgis:phutai-webgis data scratch
install -o root -g root -m 0600 .env.example /etc/phutai-webgis.env
```

Chỉnh `/etc/phutai-webgis.env` trực tiếp trên máy chủ qua kênh quản trị an toàn nếu cần khóa tích hợp; để trống các khóa tùy chọn chưa dùng. File này do systemd đọc, không đặt trong document root hoặc Git. Giữ `WEBGIS_REQUIRE_AUTH=1`, `WEBGIS_ALLOW_REGISTRATION=0`, `WEBGIS_ENABLE_DEMO_ACCOUNTS=0`; unit cũng cố định ba lựa chọn này. Không sao chép file `.env` cũ có bí mật vào nguồn công khai.

## 3. Khởi tạo tài khoản và dịch vụ

Tạo database tài khoản mới trước khi mở website. Không phục hồi `data/webgis.db` từ ZIP: nó có thể chứa tài khoản và phiên đăng nhập cũ. Chạy CLI tương tác bằng đúng người dùng dịch vụ; mật khẩu nhập ẩn, không đặt trong tham số lệnh hoặc tin nhắn:

```bash
cd /opt/phutai-webgis
test ! -e data/webgis.db
runuser -u phutai-webgis -- env \
    WEBGIS_REQUIRE_AUTH=1 WEBGIS_ALLOW_REGISTRATION=0 WEBGIS_ENABLE_DEMO_ACCOUNTS=0 \
    .venv/bin/python -m backend.admin_cli

install -o root -g root -m 0644 deploy/phutai-webgis.service \
    /etc/systemd/system/phutai-webgis.service
systemd-analyze verify /etc/systemd/system/phutai-webgis.service
systemctl daemon-reload
systemctl enable --now phutai-webgis.service
systemctl status --no-pager phutai-webgis.service
```

Giữ một worker vì ứng dụng lưu bộ nhớ đệm lớp GIS trong tiến trình. Không dùng cron hoặc terminal nền để thay thế dịch vụ. Khi có lỗi, đọc `journalctl -u phutai-webgis.service -n 100 --no-pager`, xử lý nguyên nhân và chạy lại phần bị lỗi; không mở quyền ghi toàn máy.

Kiểm tra trước khi cấu hình website:

```bash
curl --fail http://127.0.0.1:8000/api/health
test "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/api/layers)" = 401
test "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/data/webgis.db)" = 404
test "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/.env)" = 404
```

Health phải trả `status: "ok"`; API dữ liệu chưa đăng nhập phải trả `401`, tệp riêng phải trả `404`. Xác nhận tiến trình chỉ nghe `127.0.0.1:8000`, không mở cổng `8000` ra Internet. Kiểm tra localhost chưa chứng minh website công khai đã hoạt động.

## 4. Tạo website Plesk, proxy và HTTPS

Dùng website riêng cho địa chỉ hợp lệ đã chọn ở bước đầu. Nếu dùng subdomain, người có quyền tương ứng dùng **Add Subdomain**, chọn domain còn hạn và document root riêng. Chỉ dùng `gis.dung1412.online` nếu domain cũ đã được gia hạn và DNS đã kiểm tra. Xác nhận DNS của hostname trỏ đúng máy chủ; với tên miền tạm, nhà cung cấp xác nhận cách gắn hostname và cấp chứng chỉ. Không đổi document root/vhost của website khác. Repository không tự tạo subdomain, gia hạn domain hoặc thay DNS; chỉ báo URL sau khi backend, DNS, proxy và TLS đã kiểm tra thành công.

Ở website WebGIS → **Apache & nginx Settings → Additional nginx directives**, nhà cung cấp áp dụng proxy dưới đây sau khi kiểm tra các quy tắc sẵn có; không sửa trực tiếp file cấu hình Plesk tự sinh:

```nginx
client_max_body_size 200m;

location ~ ^/(?!\.well-known/acme-challenge/) {
    proxy_pass http://127.0.0.1:8000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
}
```

Tắt tùy chọn phục vụ trực tiếp file tĩnh của website nếu nó ưu tiên các location khác, giữ document root không chứa dữ liệu riêng. Kiểm tra cấu hình nginx trước khi áp dụng; không thêm trùng quy tắc đã có. Nếu gói hosting ẩn mục này, nhà cung cấp phải cấu hình proxy cho vhost tương ứng. Không cần bật Passenger.

Cấp chứng chỉ TLS hợp lệ trong Plesk sau khi DNS đúng; chuyển HTTP sang HTTPS khi chứng chỉ sẵn sàng. Chỉ công khai `80/443`, bảo toàn firewall/website khác. Không đăng nhập hoặc chuyển hồ sơ riêng qua HTTP. HTTPS cũng cần cho GPS/camera của trình duyệt.

Từ trình duyệt ngoài máy chủ, mở URL HTTPS thật, kiểm tra `/api/health`, giao diện Phú Tài, đăng nhập và thử nhập một lớp GIS nhỏ. Kiểm tra lại dữ liệu không xem được khi chưa đăng nhập và không tải trực tiếp database/`.env`. Ảnh nền và các tích hợp ngoài cần truy cập Internet riêng; không coi healthcheck là kiểm tra đầy đủ các tích hợp.

## 5. Dữ liệu riêng, sao lưu và cập nhật

Chuyển riêng lớp rừng/catalog/hồ sơ cần thiết qua kênh quản trị an toàn hoặc chức năng nhập sau đăng nhập. Giữ `data/`, `scratch/`, file môi trường và bản sao lưu ngoài document root; dữ liệu nhập phải thuộc `phutai-webgis:phutai-webgis`. Không đưa toàn bộ ZIP, CCCD, sổ đỏ, database tài khoản hoặc khóa dịch vụ lên Git công khai. Mã nguồn có các tài nguyên công khai cần thiết; [data/README.md](../data/README.md) ghi rõ phần dữ liệu gốc còn thiếu.

Nhà cung cấp sao lưu `data/`, `scratch/`, `/etc/phutai-webgis.env` vào nơi hạn chế quyền truy cập. Để giữ SQLite/lớp/catalog nhất quán, dừng dịch vụ trong cửa sổ bảo trì rồi sao lưu, khởi động lại kể cả khi sao lưu lỗi; giữ bản sao ngoài máy chủ và kiểm tra phục hồi.

Khi cập nhật, sao lưu trước, dừng dịch vụ, kiểm tra thay đổi và trạng thái Git; dùng `git pull --ff-only` nếu checkout sạch, cài lại `requirements.lock` trong cùng venv rồi chạy `pip check`. Chỉ cập nhật unit khi đã xem xét thay đổi và sao lưu unit cũ, sau đó `systemctl daemon-reload` và khởi động lại dịch vụ. Không ghi đè file môi trường, không tạo lại tài khoản, không xóa database hoặc dữ liệu để cập nhật. Kiểm tra lại API, đăng nhập và URL HTTPS sau mỗi lần cập nhật.
