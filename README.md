# Trợ lý Giám thị - Offline-First PWA & WebRTC P2P (v5.0)

Ứng dụng quản lý nề nếp trường học chạy hoàn toàn ở trình duyệt, không có backend riêng, không cần build và **vận hành trọn đời với chi phí 0 VNĐ**.

Phiên bản 5.0 nâng cấp toàn diện: hỗ trợ **Progressive Web App (PWA) Offline-First**, lưu trữ bền bỉ với **IndexedDB (500MB+)**, kênh truyền dự phòng ngang hàng **WebRTC DataChannel P2P**, **AI Cục bộ gợi ý học sinh & phát hiện tái phạm**, cùng cơ chế **tự động sao lưu Cloud cá nhân Google Drive / xuất chuẩn SMAS - VnEdu**.

---

## Tính Năng Nổi Bật v5.0 (100% Miễn Phí - 0 VNĐ)

1. **PWA & Offline-First**: Cài đặt ứng dụng trực tiếp lên màn hình chính điện thoại (iOS, Android) hoặc máy tính Windows/Mac. Sử dụng Service Worker (`sw.js`) để hoạt động mượt mà kể cả khi mất kết nối mạng.
2. **Lưu trữ IndexedDB (Dung lượng lớn)**: Nâng cấp từ `localStorage` lên `IndexedDB` chuẩn trình duyệt, nâng hạn mức lưu trữ lên tới hàng chục nghìn bản ghi (500MB+), tự động di chuyển (migration) dữ liệu cũ không làm mất bản ghi.
3. **Kênh truyền kép WebRTC DataChannel P2P**: Báo hiệu qua MQTT và tự động thiết lập kết nối ngang hàng trực tiếp giữa Client và Host qua STUN server miễn phí của Google (`stun:stun.l.google.com:19302`). Độ trễ truyền dữ liệu gần như bằng 0 trong mạng Wi-Fi trường học. Tự động chuyển đổi mượt mà với MQTT khi có sự cố.
4. **Local On-Device AI (Không tốn tiền API)**:
   - **AI Roster & Gợi ý Thông Minh**: Nạp danh sách học sinh toàn trường từ Excel; khi gõ hoặc đọc giọng nói `12A1 An trễ`, AI tự động gợi ý chính xác học sinh `Nguyễn Văn An`, chống nhập sai tên.
   - **Cảnh báo Tái Phạm (Repeat Offender Detector)**: Tự động phân tích tần suất vi phạm của học sinh và gắn huy hiệu cảnh báo (`Tái phạm 2x`, `Tái phạm 3x`).
5. **Sao lưu Cloud Cá nhân & Xuất Chuẩn VnEdu / SMAS**:
   - Tự động tạo snapshot sao lưu định kỳ trong IndexedDB.
   - Hỗ trợ kết nối Google Drive cá nhân qua Client OAuth2 để sao lưu 1-click vào Drive của người dùng (0đ chi phí cloud).
   - Xuất file Excel chuẩn cấu trúc đối soát phần mềm quản lý trường học **SMAS** và **VnEdu**.

---

## Chạy ứng dụng

Không nên mở trực tiếp bằng `file://` vì Web Crypto, Clipboard, Service Worker và worker OCR sẽ bị trình duyệt hạn chế. Dùng một static server tại thư mục dự án:

```powershell
python -m http.server 8080
```
hoặc nếu máy có Node.js:
```powershell
npx --yes serve .
```

Mở URL `http://localhost:8080` trên trình duyệt Chrome, Edge hoặc Safari.

---

## Vận hành

1. **Host (Máy Chủ Giám Thị)**: Chọn danh tính và nhấn **Khởi động Máy Chủ**.
2. **Chia sẻ mã phòng**: Host đọc hoặc sao chép mã phòng 12 chữ số (ví dụ `0123-4567-8901`) cho các đội trực / lớp.
3. **Client (Đội trực / Lớp)**: Nhập mã phòng, chọn vai trò và nhấn **Kết Nối Ngay**.
4. **Kết nối kép tự động**: Hệ thống đồng bộ qua MQTT và tự động mở kênh trực tiếp **WebRTC DataChannel P2P** giữa Client và Host khi điều kiện mạng cho phép (hiển thị huy hiệu `P2P Direct`).
5. **Nạp danh sách học sinh (AI Roster)**: Nhấn biểu tượng danh bạ trên thanh công cụ để tải lên danh sách học sinh trường, kích hoạt gợi ý thông minh khi nhập liệu.

---

## Bảo mật và Tiêu chuẩn Mã nguồn

- **Mã hóa đầu cuối (E2EE)**: Toàn bộ dữ liệu trao đổi đều được mã hóa bằng AES-GCM 256-bit với khóa dẫn xuất SHA-256 từ mã phòng.
- **An toàn DOM**: Tuyệt đối không sử dụng `innerHTML` để loại bỏ nguy cơ DOM XSS.
- **Sinh khóa an toàn**: Sử dụng `crypto.getRandomValues()`, không sử dụng `Math.random()`.
- **Chính sách CSP nghiêm ngặt**: Kiểm soát chặt chẽ các nguồn script và kết nối mạng.

---

## Triển khai miễn phí bằng GitHub Pages

1. Đẩy repository lên GitHub.
2. Vào **Settings > Pages**.
3. Chọn **Deploy from a branch**, chọn nhánh chính và thư mục `/ (root)`.
4. Mở URL `https://<tai-khoan>.github.io/<repo>/` sau khi Pages hoàn tất. GitHub Pages cung cấp HTTPS miễn phí để kích hoạt đầy đủ Web Crypto, PWA và Service Worker.

---

## Cấu trúc Tệp tin

- `index.html`: Giao diện ứng dụng, PWA links, AI Autocomplete UI, Roster & Cloud Modals, CSP.
- `style.css`: Hệ thống thiết kế Dark Theme, hiệu ứng Glassmorphism, huy hiệu P2P/MQTT, AI chip.
- `manifest.json`: Web App Manifest tiêu chuẩn PWA cài đặt trên thiết bị di động và máy tính.
- `sw.js`: Service Worker quản lý vòng đời ứng dụng và lưu trữ bộ nhớ đệm Offline-First.
- `app-config.js`: Cấu hình broker MQTT, WebRTC STUN servers, IndexedDB, hạn mức lưu trữ.
- `script.js`: Toàn bộ logic lưu trữ IndexedDB, P2P DataChannel, AI Roster, E2EE AES-GCM, Offline Queue.
