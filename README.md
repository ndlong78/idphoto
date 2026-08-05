# PhotoVisa — ID Photo Generator

Ứng dụng web tạo ảnh hộ chiếu / visa / CCCD theo kích thước hồ sơ ngay trên trình duyệt. **Không upload ảnh lên server** — toàn bộ xử lý diễn ra 100% client-side.

> PhotoVisa hỗ trợ căn chỉnh và xuất file theo kích thước đã chọn. Kết quả vẫn cần được người dùng đối chiếu với yêu cầu mới nhất của cơ quan tiếp nhận; ứng dụng không bảo đảm hồ sơ sẽ được chấp nhận.

## Tính năng

- 🤖 **AI tách nền** (ISNet via @imgly/background-removal) — fallback flood fill nếu CDN chậm
- 👤 **Nhận diện khuôn mặt** tự động (TinyFaceDetector via face-api.js)
- ✂️ **Crop / zoom / kéo** tương tác với chuột và cảm ứng
- 🎨 **Điều chỉnh ảnh**: độ sáng, tương phản, độ sắc nét, làm mịn da
- 📐 **Nhiều định dạng**: Hộ chiếu VN (40×60mm), CCCD (30×40mm), US Visa (51×51mm), Schengen, UK, Nhật Bản
- 💾 **Xuất ảnh đơn**: JPG 600 DPI (in), JPG 300 DPI (email), PNG, sao chép clipboard
- 🖨️ **Tờ in nhiều ảnh**: tự xếp bản sao đúng kích thước lên giấy 10×15 cm hoặc A4, có dấu cắt tùy chọn
- 🔒 **Bảo mật**: CSP nghiêm ngặt, allowlist CDN, không lưu ảnh

## Cài đặt & Chạy

Ứng dụng dùng ES6 modules thuần — không cần build tool. Mở `index.html` qua bất kỳ web server nào hỗ trợ HTTPS (CSP yêu cầu).

```bash
# Ví dụ với Node.js serve
npx serve .
# hoặc
python3 -m http.server 8080
```

> **Lưu ý:** `unsafe-eval` trong CSP là bắt buộc do `onnxruntime-web` (dependency của @imgly)
> cần `eval` để chạy WASM. App không nhận HTML/script từ API hoặc input người dùng nên rủi ro thực tế thấp.

## Cấu hình (tùy chọn)

Tạo file `.env` hoặc inject vào `window.__IDPHOTO_CONFIG__` trước khi load script:

```html
<script>
  window.__IDPHOTO_CONFIG__ = {
    telemetryEndpoint:    'https://your-analytics.example.com/events', // mặc định: tắt
    telemetryConsoleLevel: 'warn',  // 'silent' | 'error' | 'warn' | 'info' (mặc định: 'error')
  };
</script>
```

Tham khảo `.env.example` để biết thêm chi tiết.
`telemetryEndpoint` chỉ chấp nhận:
- `https://...` cho production
- `http://localhost...`, `http://127.0.0.1...`, `http://[::1]...` cho local dev

## Cấu trúc dự án

```
src/
├── main.js                # Entry point, pipeline xử lý ảnh
├── ai.js                  # Load & chạy model AI (background removal, face detection)
├── render.js              # Canvas rendering, mask blending, image adjustments
├── crop.js                # Canvas crop tương tác (drag, zoom, pinch)
├── ui.js                  # UI bindings, toast notifications
├── export.js              # Render và download ảnh đơn 300/600 DPI
├── export-render.js       # Canvas export chính xác dùng chung
├── print-sheet-layout.js  # Tính lưới giấy bằng mm, không phụ thuộc DOM
├── print-sheet.js         # Ghép và tải tờ in JPEG 300 DPI
├── print-sheet-view.js    # Điều khiển khổ giấy, số bản, khoảng cách, dấu cắt
├── image-metadata.js      # Ghi metadata DPI cho JPEG/PNG
├── state.js               # Global state, FMTS, validateImageFile
├── telemetry.js           # Logging event (privacy-safe: không fingerprint trong localStorage)
├── security.js            # URL allowlist, CSP enforcement
├── constants.js           # Hằng số dùng chung
└── pipeline.js            # Enum bước xử lý
```

## Tờ in nhiều ảnh

Trong card **Xuất ảnh**, phần **Tờ in nhiều ảnh** cho phép:

- chọn giấy ảnh `10 × 15 cm` hoặc `A4`;
- chọn số bản cụ thể hoặc dùng sức chứa tối đa;
- chọn khoảng cách 2–5 mm;
- bật/tắt dấu cắt;
- xem trước số cột, số hàng, sức chứa và kích thước từng ảnh bằng văn bản.

Layout engine thử cả hướng dọc và ngang rồi chọn hướng chứa được nhiều ảnh nhất. Mỗi ảnh con được render ở đúng kích thước vật lý của preset; ảnh không bị kéo giãn hoặc cắt thêm. Hàng cuối có ít ảnh được căn giữa độc lập.

Tờ in dùng JPEG **300 DPI**. Đây là mức in ảnh chất lượng cao đồng thời giữ mức sử dụng bộ nhớ hợp lý. A4 600 DPI sẽ tạo canvas khoảng 9.921 × 14.031 px và có thể cần hơn 500 MB RAM chỉ cho buffer RGBA, không phù hợp với nhiều điện thoại và trình duyệt mobile.

Dấu cắt được vẽ ngoài vùng ảnh khi khoảng cách đủ lớn. Audit JSON/ZIP chỉ áp dụng cho ảnh đơn; tờ in có receipt riêng nhưng không tạo audit có thể gây hiểu sai rằng toàn bộ tờ giấy là một ảnh hồ sơ.

## Phát triển

```bash
# Cài đặt dev dependencies
npm install

# Chạy test
npm test

# Chạy test (watch mode)
npm run test:watch

# Lint
npm run lint

# Lint + tự sửa
npm run lint:fix
```

### Browser export E2E

Playwright được ghim ở phiên bản `1.61.1` trong workflow nhưng không được thêm vào dependency/lockfile của website. Để chạy local:

```bash
# Cài test runner mà không thay đổi package.json/package-lock.json
npm install --no-save --package-lock=false --ignore-scripts @playwright/test@1.61.1

# Cài ba browser engine dùng trong CI
npx playwright install chromium firefox webkit

# Chạy toàn bộ desktop/mobile Chromium, cross-browser và iPhone WebKit
npm run test:e2e

# Hoặc chạy riêng từng nhóm
npm run test:e2e:desktop
npm run test:e2e:mobile
npm run test:e2e:cross-browser
npm run test:e2e:iphone

# Chỉ chạy hành trình upload → editor → xác nhận → export
npm run test:e2e:journey

# Chỉ chạy validation, cancel confirmation và reset lifecycle
npm run test:e2e:validation

# Chỉ chạy hành trình upload → touch crop/pinch → export trên Pixel 7
npm run test:e2e:mobile-journey

# Chỉ chạy rotation và viewport điện thoại nhỏ
npm run test:e2e:rotation

# Chỉ chạy tờ in 10x15 và A4
npm run test:e2e:print-sheet
```

Bộ E2E dùng `scripts/static-server.mjs`, không gọi AI/CDN và kiểm tra download event thật, nội dung ZIP, receipt cùng recovery controls. Hành trình đầy đủ tạo PNG fixture ngay trong browser, đưa file qua input upload thật, chạy `FileReader`, canvas editor, compliance/readiness, dialog xác nhận, renderer, metadata DPI và delivery layer trước khi đọc lại file tải xuống. Nhóm validation/reset kiểm tra file sai định dạng, file quá lớn, hủy dialog không tạo download, file lỗi không phá phiên hiện tại và mọi đường chọn ảnh mới đều xóa receipt, recovery cùng staged ZIP của ảnh trước. Journey mobile chạy bằng Pixel 7 emulation, gửi touch input một ngón và hai ngón vào crop canvas, xác nhận layout/dialog/receipt không tràn viewport, rồi đọc lại JPG hoặc ZIP/PNG để kiểm tra kích thước pixel, metadata DPI, audit và privacy flags. Suite cross-browser chạy hai journey xuất JPG và ZIP audit trên Chromium, Firefox và WebKit; mỗi engine tự tạo fixture canvas rồi kiểm tra file tải ở mức byte. Suite iPhone WebKit chạy cùng hành trình upload/export trên iPhone SE và iPhone 13 emulation, dùng tap/scroll mobile, xoay portrait/landscape, kiểm tra session không bị reset, dialog không tràn viewport và đọc lại JPG/ZIP tải xuống. Suite print-sheet tạo tờ 10×15 sáu ảnh và A4 ba ảnh, sau đó đọc lại JPEG để kiểm tra pixel, DPI, filename và receipt. Đây là WebKit mobile emulation, không thay thế hoàn toàn kiểm thử trên thiết bị iOS Safari thật. Report local nằm trong `playwright-report/`; trace, screenshot và video chỉ được giữ khi test thất bại.

## Yêu cầu mạng

Lần đầu tải model AI (~50MB):
- `https://esm.sh` — bundle @imgly/background-removal
- `https://staticimgly.com` — model weights ISNet FP16
- `https://cdn.jsdelivr.net` — face-api.js + TinyFaceDetector weights

Sau lần đầu, model được cache bởi trình duyệt.

## Bảo mật & Quyền riêng tư

- ✅ Ảnh không rời khỏi thiết bị người dùng
- ✅ Telemetry mặc định tắt (chỉ bật khi cấu hình endpoint)
- ✅ Dữ liệu fingerprinting (UA, platform, memory) **không** lưu vào localStorage
- ✅ Tất cả URL remote được kiểm tra qua allowlist trước khi tải
- ⚠️ Tài nguyên AI vẫn được tải runtime từ CDN đã allowlist; để giảm rủi ro supply-chain, nên self-host ở môi trường production quan trọng

## Giấy phép

Xem file `LICENSE`.
