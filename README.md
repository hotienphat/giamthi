# Trợ lý Giám thị - web tĩnh v4

Ứng dụng quản lý vi phạm chạy hoàn toàn ở trình duyệt, không có backend riêng và không cần build. Host giữ dữ liệu chính trong `localStorage`; các máy Client trao đổi thời gian thực qua WebSocket MQTT công cộng.

## Chạy ứng dụng

Không nên mở trực tiếp bằng `file://` vì Web Crypto, Clipboard, worker OCR và một số trình duyệt sẽ hạn chế tính năng. Dùng một static server tại thư mục dự án:

```powershell
npx --yes serve .
```

Mở URL localhost do lệnh trên hiển thị. Có thể dùng `python -m http.server 8080` nếu máy đã cài Python.

## Vận hành

1. Host chọn danh tính và tạo phòng.
2. Host đọc hoặc sao chép mã phòng 12 ký tự, ví dụ `ABCD-EFGH-JKLM`, và gửi riêng cho Client.
3. Client nhập hoặc dán mã phòng, chọn vai trò, nhập tên và kết nối.
4. Client chỉ vào màn hình chính sau khi Host gửi ACK/SYNC. Nếu Host không phản hồi trong 15 giây, ứng dụng báo timeout rõ ràng.
5. Giữ tab Host mở. MQTT tự kết nối lại đúng broker được mã hóa trong ký tự đầu của mã phòng.

Mã phòng được chia thành ba nhóm để dễ đọc qua điện thoại hoặc ghi tay; không dùng `0`, `O`, `1`, `I` để tránh nhầm. Ứng dụng dẫn xuất ID phòng và khóa AES-GCM từ mã bằng SHA-256. Không đăng mã lên nhóm hoặc trang công khai. Phần mật khẩu lớp trong giao diện chỉ là rào cản tiện dụng ở frontend, không phải cơ chế xác thực an toàn vì mã nguồn web luôn có thể xem được.

## Dữ liệu, queue và backup

- Dữ liệu Host, session Client và queue được namespace theo từng room.
- Logout Host không xóa dữ liệu. Nút khôi phục phòng gần nhất cho phép mở lại cùng phòng và secret.
- Queue Client lưu bền vững mọi thao tác thêm, sửa, xóa; mỗi thao tác có `operationId` và chỉ bị bỏ sau ACK của Host.
- Host dedupe `operationId` và ID bản ghi, rồi phát SYNC chuẩn cho các Client.
- Lần đầu tạo/khôi phục phòng v4, Host sao chép dữ liệu từ khóa v3 cũ vào phòng hiện tại và ghi dấu migration để không nhân bản sang các phòng mới. Dữ liệu v3 gốc không bị xóa.
- Dùng **Backup JSON** thường xuyên, đặc biệt trước khi xóa nhiều hoặc đổi trình duyệt/máy.
- **Phục hồi JSON** chỉ dành cho Host. Dữ liệu hiện tại được lưu thành snapshot trước khi phục hồi.
- **Xóa tất cả** tạo snapshot cục bộ và có thể hoàn tác. Chỉ giữ ba snapshot gần nhất.

`localStorage` không phải kho lưu trữ lâu dài: người dùng xóa dữ liệu website, chế độ riêng tư, lỗi ổ đĩa hoặc giới hạn quota đều có thể làm mất dữ liệu. Backup JSON ra file là biện pháp phục hồi chính.

## Excel và tìm kiếm

- Nút tải template tạo file mẫu ngay trên trình duyệt.
- Import tìm header trong 10 dòng đầu, không phụ thuộc vị trí cột. Các header bắt buộc là Họ tên, Lớp và Lỗi vi phạm; có thể thêm Người báo, Thời gian.
- Có tìm tên/người báo, lọc lớp, lọc loại vi phạm và thống kê số dòng/lớp/loại.
- Lớp hợp lệ có dạng khối 10-12, một chữ cái và 1-2 chữ số, ví dụ `10A1`, `12B12`.

## Giới hạn mặc định

Các giới hạn nằm trong `app-config.js`:

- 3.000 bản ghi mỗi phòng.
- 200 dòng mỗi thao tác/import.
- Payload logic 256 KiB.
- Excel và JSON tối đa 5 MiB.
- Ảnh OCR tối đa 8 MiB.
- Queue Client giữ tối đa 500 thao tác hợp lệ khi nạp lại.

Có thể thay danh sách broker và giới hạn trong `app-config.js`. Client không tự chọn broker dự phòng khác Host; broker được cố định trong mã phòng để hai phía luôn gặp nhau.

## Bảo mật và giới hạn

- Dữ liệu MQTT được mã hóa đầu cuối bằng AES-GCM với khóa dẫn xuất SHA-256 từ mã phòng ngẫu nhiên khi chạy trong secure context (`https://` hoặc localhost) và trình duyệt có Web Crypto.
- Nếu Web Crypto không khả dụng, ứng dụng cảnh báo và dùng plaintext để vẫn vận hành. Không nên sử dụng fallback này cho dữ liệu thật.
- Broker MQTT công cộng vẫn thấy metadata giao thông như topic, thời điểm và kích thước gói; broker có thể gián đoạn, giới hạn lưu lượng hoặc ngừng dịch vụ. Không có cam kết bảo mật hay độ sẵn sàng tuyệt đối.
- Bất kỳ ai có mã phòng đều có thể dẫn xuất khóa và đọc/gửi payload trong phòng. Mã ngắn thực dụng hơn nhưng yếu hơn mã mời dài trước đây trước việc dò chủ động; không đăng công khai và nên tạo phòng mới theo mỗi ca trực. AES-GCM không thay thế quản lý danh tính, phân quyền server hoặc thu hồi khóa.
- ACK xác nhận Host đã xử lý thao tác trong phiên. MQTT công cộng và `localStorage` không tạo thành hệ thống giao dịch có độ bền như cơ sở dữ liệu backend.
- CSP giảm bề mặt chèn script nhưng trang vẫn phụ thuộc CDN cho font, icon, MQTT, Excel, PNG và OCR. Nếu CDN lỗi, tính năng tương ứng không hoạt động.

## Triển khai miễn phí bằng GitHub Pages

1. Đẩy repository lên GitHub bằng quy trình quản trị mã nguồn của bạn.
2. Vào **Settings > Pages**.
3. Chọn **Deploy from a branch**, branch cần triển khai và thư mục `/ (root)`.
4. Mở URL `https://<tai-khoan>.github.io/<repo>/` sau khi Pages hoàn tất.

GitHub Pages cung cấp HTTPS phù hợp cho Web Crypto. Không đưa backup, mã phòng hoặc dữ liệu thật vào repository.

## File chính

- `index.html`: giao diện và CSP.
- `style.css`: thiết kế hiện có cùng các thành phần lọc/trạng thái mới.
- `app-config.js`: broker và giới hạn vận hành.
- `script.js`: lưu trữ, validation, MQTT, mã hóa, queue/ACK, import/export.

## Kiểm tra mã nguồn

Không cần cài package để chạy các kiểm tra tĩnh hiện có:

```powershell
node --check script.js
node --check app-config.js
node tests/security.test.js
git diff --check
```
