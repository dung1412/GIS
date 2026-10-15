# Triển khai WebGIS Phú Tài trên VPS Plesk

Hosting hiện tại **không hỗ trợ Docker**. Dùng [DEPLOY_NO_DOCKER.md](DEPLOY_NO_DOCKER.md): nhà cung cấp chạy Python 3.12/Uvicorn bằng systemd và cấu hình nginx Plesk. Tài liệu đó có mẫu yêu cầu hỗ trợ cho người dùng chỉ có quyền quản trị Plesk.

Phần còn lại của tài liệu này là phương án thay thế **chỉ dành cho máy chủ có Docker**. Container phục vụ cả API FastAPI và giao diện MapLibre. Dữ liệu dùng SQLite và các tệp GIS trong `data/`; không cần PostGIS để chạy các chức năng hiện có. GitHub Pages không chạy được API Python.

IP người dùng cung cấp: `15.235.180.82`. Ảnh Plesk hiển thị domain `dung1412.online` đang chạy WordPress; đề xuất dùng subdomain riêng `gis.dung1412.online`, **chưa xác nhận đã tạo hoặc trỏ DNS**. Giao diện website/subscription và liên kết SSH Keys không chứng minh quyền root, shell hay chạy dịch vụ thường trực. Tài liệu này chuẩn bị các bước triển khai, **không xác nhận đã cài đặt ứng dụng trên VPS**. Không gửi mật khẩu/private key/API key trong chat; cấp quyền qua kênh quản lý truy cập an toàn của máy chủ.

## Phương án Docker: dùng giao diện Plesk khi máy chủ hỗ trợ

1. Trong Plesk, kiểm tra Extensions → Docker. Quyền quản trị Plesk không tự bảo đảm có Docker: nhà cung cấp có thể chưa cài extension hoặc không cho chạy container. Nếu thiếu, nhờ nhà cung cấp cài Docker extension/chạy container WebGIS; không cần đưa mật khẩu cho người hỗ trợ qua chat.
2. Chỉ khi cần bản container mới: trên GitHub → Actions → **Publish WebGIS container → Run workflow** để chạy thủ công. Workflow chạy kiểm thử trước rồi mới build/push image Linux amd64 `ghcr.io/dung1412/gis:latest`; cập nhật `main` chỉ chạy CI, không tự xuất bản container. Bản image công khai đã xuất bản vẫn có thể pull; chỉ dùng bản cập nhật sau khi workflow thành công và kiểm tra VPS dùng kiến trúc amd64. Nếu xuất bản package mới bị đặt private, vào Packages → `gis` → Package settings → Change visibility → Public. Khi package public, Plesk có thể pull mà không cần token cá nhân.
3. Trong Plesk → Docker, tìm/pull image đầy đủ `ghcr.io/dung1412/gis:latest`; nếu giao diện chỉ tìm Docker Hub, dùng chức năng thêm registry/image riêng của phiên bản Plesk hoặc nhờ nhà cung cấp. Chọn container WebGIS, đặt restart policy, cổng trong container `8000`. Tắt ánh xạ tự động, chỉ bind host `127.0.0.1:8000`; nếu giao diện không chọn được địa chỉ bind, nhà cung cấp cần hỗ trợ hoặc chặn cổng trực tiếp trước khi đưa dữ liệu vào.
4. Thêm biến `WEBGIS_REQUIRE_AUTH=1`, `WEBGIS_ENABLE_DEMO_ACCOUNTS=0`, `WEBGIS_ALLOW_REGISTRATION=0`, `PORT=8000`. Tạo hai thư mục lưu bền vững ngoài document root, map vào `/app/data` và `/app/scratch`. Chúng phải cho UID/GID `10001:10001` ghi; File Manager có thể không đổi được numeric owner, khi đó nhờ nhà cung cấp tạo thư mục/đổi owner. Không dùng cả thư mục ZIP cũ làm `/app/data`; phải bắt đầu với database tài khoản mới.
5. Dùng console/terminal của container trong Plesk nếu có, chạy `python -m backend.admin_cli` để tạo quản trị viên bằng lời nhắc an toàn. Không có mật khẩu mặc định. Nếu Plesk không có console tương tác, nhờ nhà cung cấp chạy lệnh này qua kênh an toàn; không bật tài khoản demo để thay thế. Giữ dịch vụ chưa mở ra công khai cho đến khi khởi tạo xong.
6. Tạo website/tên miền ở phần 1, cấu hình Docker Proxy Rules và HTTPS ở phần 5. Tải lớp GIS riêng qua SFTP hoặc giao diện đăng nhập như phần 4. Kiểm tra URL thật từ trình duyệt ngoài VPS.

Các phần có lệnh shell dưới đây dành cho nhà cung cấp hoặc khi đã được cấp SSH/quyền root; chúng không giả định quyền này hiện đã có. Không có quy trình GitHub Actions nào tự đăng nhập Plesk/VPS.

## 1. Chọn địa chỉ website

Đã có `dung1412.online` trong tài khoản Plesk; không cần mua domain mới để dùng subdomain. Vào **Websites & Domains → Add Subdomain**, nhập **`gis`**, chọn **`dung1412.online`**, dùng document root riêng do Plesk tạo, không chọn thư mục `httpdocs` của WordPress. Địa chỉ đề xuất là `gis.dung1412.online`; bước này mới tạo website, chưa triển khai API.

Xác định nơi đang quản lý DNS có thẩm quyền của `dung1412.online`. Tại đó tạo bản ghi `gis` loại `A` trỏ `15.235.180.82` nếu máy chủ này được nhà cung cấp xác nhận là nơi chạy WebGIS. DNS Settings trong Plesk chỉ có tác dụng nếu nameserver đang dùng phục vụ zone đó; nếu DNS ở nhà đăng ký hoặc dịch vụ khác, cập nhật ở dịch vụ tương ứng. Không đổi bản ghi của domain gốc hoặc website khác. Chỉ coi địa chỉ hoạt động sau khi kiểm tra DNS, proxy và TLS thành công.

IP chỉ dùng kiểm tra kết nối ban đầu. Plesk có thể đang phục vụ website mặc định tại IP này; không thay cấu hình website khác để lấy địa chỉ đó. Không có domain nào được đăng ký hay tạo tự động bởi repository.

## 2. Chuẩn bị máy chủ và mã nguồn

Yêu cầu: VPS Linux, Docker Engine và Docker Compose v2. Đề xuất ít nhất 2 CPU, RAM 4 GB, đĩa trống 10 GB cho build/dependencies, cộng dung lượng dữ liệu GIS thực tế. Shared hosting không cho chạy Docker/Python thường trực cần nhà cung cấp bật tính năng này hoặc chuyển sang VPS có quyền quản trị.

Qua SSH bằng tài khoản đã được cấp quyền, kiểm tra:

```bash
docker version
docker compose version
df -h
```

Cài Docker theo tài liệu chính thức của hệ điều hành hoặc dùng Docker extension của Plesk. Plesk nhận lưu lượng trên `80/443` và chuyển tới `127.0.0.1:8000`; không mở cổng `8000` ra Internet.

Đặt mã nguồn ở thư mục riêng, **ngoài document root công khai** của Plesk:

```bash
sudo -i
install -d -m 0750 /opt/phutai-webgis
git clone https://github.com/dung1412/GIS.git /opt/phutai-webgis
cd /opt/phutai-webgis
cp .env.example .env
chmod 600 .env
install -d -m 0750 data scratch
chown -R 10001:10001 data scratch
```

Nếu thư mục đích đã có dữ liệu/mã nguồn, kiểm tra và sao lưu trước; không clone đè hoặc xoá thư mục. Các lệnh bên dưới chạy trong cùng phiên quản trị root vừa mở bằng `sudo -i`; không nới quyền `.env` ra công khai.

Chỉnh `.env` trực tiếp trên máy chủ khi cần tích hợp API. Không điền khóa chưa có, không commit `.env`. Bản đồ nền công khai và xử lý GIS cục bộ không bắt buộc các khóa dịch vụ tùy chọn. Compose luôn bật xác thực, tắt tài khoản demo và tắt tự đăng ký.

## 3. Build và tạo tài khoản quản trị

```bash
cd /opt/phutai-webgis
docker compose build --pull
docker compose run --rm webgis python -m backend.admin_cli
docker compose up -d
docker compose ps
curl --fail http://127.0.0.1:8000/api/health
```

CLI hỏi thông tin trực tiếp trong terminal; mật khẩu không hiện khi gõ. Chỉ tạo tài khoản trên máy chủ đã kiểm soát quyền truy cập. Không có mật khẩu mặc định. Nếu tạo tài khoản thất bại, đọc lỗi và khắc phục trước khi mở website. CLI dùng cùng bind mount `data/` nên tài khoản được giữ khi thay container.

Kiểm tra API bảo vệ dữ liệu trả `401` khi chưa đăng nhập:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8000/api/layers
```

Theo dõi lỗi nếu healthcheck không thành công:

```bash
docker compose logs --tail=100 webgis
```

Image dùng Python 3.12 và `requirements.lock`, chạy bằng UID/GID `10001:10001`. Lỗi `Permission denied` trong `data/` hoặc `scratch/` cần sửa quyền sở hữu các thư mục này trên host. Chỉ chạy một worker vì ứng dụng giữ bộ nhớ đệm lớp GIS trong tiến trình.

## 4. Chuyển dữ liệu GIS riêng tư

`data/` và `scratch/` là bind mount tồn tại trên host. Khi khởi động, container chỉ bổ sung fonts và ranh giới tỉnh công khai còn thiếu, giữ nguyên tệp đã có. Mã nguồn/image công khai không chứa database người dùng, phiên đăng nhập, lớp rừng riêng, hồ sơ/sổ đỏ, bảng tính, thư mục `source_tab` hoặc dữ liệu thử từ gói ZIP.

Để dùng các lớp GIS trong gói đã gửi, chuyển qua SFTP/SSH hoặc nhập bằng giao diện sau khi đăng nhập. Không upload cả gói ZIP vào document root của Plesk, không commit dữ liệu đó lên GitHub. Chuyển riêng lớp dữ liệu và catalog cần thiết; không khôi phục `webgis.db` từ gói mẫu vì có thể mang theo tài khoản và phiên cũ. Kiểm tra cặp catalog/layer nhất quán, quyền sở hữu `10001:10001`, rồi chạy:

```bash
docker compose restart webgis
```

## 5. Cấu hình Plesk reverse proxy và HTTPS

Chọn **một** cách cho website đã tạo ở bước 1.

**Docker extension:** nếu Plesk nhận container do Compose tạo, vào website → Docker Proxy Rules, thêm quy tắc `/` tới container `webgis`, cổng trong container `8000`. Giữ ánh xạ host `127.0.0.1:8000`; không bật ánh xạ công khai tự động. Nếu extension không hỗ trợ container ngoài giao diện hoặc bind localhost, dùng nginx bên dưới.

**Plesk nginx:** vào website → Apache & nginx Settings, thêm vào Additional nginx directives. Áp dụng cho website WebGIS riêng; không sửa trực tiếp file cấu hình do Plesk tự sinh:

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

Tắt tùy chọn phục vụ trực tiếp file tĩnh nếu nó ưu tiên đường dẫn trong document root. Plesk kiểm tra cấu hình khi lưu. Không thêm quy tắc nginx này khi đã dùng Docker Proxy Rules. Nếu nginx chạy ngoài host Docker, cần điều chỉnh mạng; `127.0.0.1` ở đây phải là chính host Docker.

Vào SSL/TLS Certificates của website, cấp chứng chỉ Let's Encrypt sau khi DNS trỏ đúng; bật chuyển HTTP → HTTPS khi chứng chỉ hợp lệ. Cho phép `80/443` qua firewall để cấp chứng chỉ và truy cập web, giữ `8000` chỉ trên localhost. Không đăng nhập hoặc đưa dữ liệu nhạy cảm qua HTTP.

Kiểm tra `https://<tên-website>/api/health` trả JSON thành công, mở `https://<tên-website>/`, đăng nhập và thử nhập một lớp GIS nhỏ. Kiểm tra từ trình duyệt bên ngoài VPS; healthcheck localhost không chứng minh website đã public. Một số lớp nền/ảnh vệ tinh cần trình duyệt và VPS truy cập các dịch vụ bản đồ bên ngoài.

## 6. Cập nhật và sao lưu

Sao lưu riêng `data/`, `scratch/` và `.env` vào nơi hạn chế quyền truy cập, ngoài document root; không đưa bản sao lưu lên repository. Để sao lưu SQLite cùng lớp/catalog nhất quán, dừng dịch vụ trong cửa sổ bảo trì, tạo bản sao rồi khởi động lại kể cả khi sao lưu lỗi. Lưu bản sao ngoài VPS và kiểm tra phục hồi.

Sau khi sao lưu và xem xét thay đổi, cập nhật:

```bash
cd /opt/phutai-webgis
git pull --ff-only
docker compose build --pull
docker compose up -d
curl --fail http://127.0.0.1:8000/api/health
```

Kiểm tra lại URL HTTPS và chức năng đăng nhập/đọc lớp GIS. Dữ liệu bind mount được giữ khi thay image. Không xoá `data/`, `scratch/` hoặc prune bản sao lưu như một bước cập nhật thông thường.
