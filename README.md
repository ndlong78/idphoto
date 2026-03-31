# PhotoVisa — ID Photo Generator

Ứng dụng web tạo ảnh hộ chiếu / visa / CCCD chuẩn kích thước ngay trên trình duyệt. **Không upload ảnh lên server** — toàn bộ xử lý diễn ra 100% client-side.

## Tính năng

- 🤖 **AI tách nền** (ISNet via @imgly/background-removal) — fallback flood fill nếu CDN chậm
- 👤 **Nhận diện khuôn mặt** tự động (TinyFaceDetector via face-api.js)
- ✂️ **Crop / zoom / kéo** tương tác với chuột và cảm ứng
- 🎨 **Điều chỉnh ảnh**: độ sáng, tương phản, độ sắc nét, làm mịn da
- 📐 **Nhiều định dạng**: Hộ chiếu VN (35×45mm), CCCD (30×40mm), US Visa (51×51mm), Schengen, UK, Nhật Bản
- 💾 **Xuất ảnh**: JPG 600 DPI (in), JPG 300 DPI (email), PNG, sao chép clipboard
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
> cần `eval` để chạy WASM. App không nhận HTML/script từ nguồn bên ngoài nên rủi ro thực tế thấp.

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
├── main.js        # Entry point, pipeline xử lý ảnh
├── ai.js          # Load & chạy model AI (background removal, face detection)
├── render.js      # Canvas rendering, mask blending, image adjustments
├── crop.js        # Canvas crop tương tác (drag, zoom, pinch)
├── ui.js          # UI bindings, export ảnh, toast notifications
├── state.js       # Global state, FMTS, validateImageFile
├── telemetry.js   # Logging event (privacy-safe: không fingerprint trong localStorage)
├── security.js    # URL allowlist, CSP enforcement
├── constants.js   # Hằng số dùng chung
└── pipeline.js    # Enum bước xử lý
tests/
├── pipeline.test.js
├── render.test.js
├── security.test.js
├── telemetry.test.js
└── validation.test.js
```

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
