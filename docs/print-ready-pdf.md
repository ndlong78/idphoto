# Print-ready PDF export

PhotoVisa có thể xuất cùng một bố cục tờ in dưới hai định dạng:

- **JPEG 300 DPI** — phù hợp để gửi tiệm ảnh hoặc dùng trong phần mềm xử lý ảnh;
- **PDF đúng khổ** — phù hợp khi in trực tiếp bằng trình xem PDF và cần giữ kích thước vật lý của trang.

## Kích thước trang

PDF sử dụng đơn vị point theo chuẩn PDF, với `72 point = 1 inch`.

| Khổ | Hướng | MediaBox xấp xỉ |
| --- | --- | --- |
| 10 × 15 cm | Dọc | `283.4646 × 425.1969 pt` |
| 10 × 15 cm | Ngang | `425.1969 × 283.4646 pt` |
| A4 | Dọc | `595.2756 × 841.8898 pt` |
| A4 | Ngang | `841.8898 × 595.2756 pt` |

JPEG tờ in 300 DPI hiện có được nhúng nguyên vẹn dưới dạng `/DCTDecode` và phủ toàn bộ trang. PDF không chạy một layout engine khác, không crop lại ảnh và không thay đổi dấu cắt.

## Cách in đúng kích thước

Trong hộp thoại in của trình xem PDF:

1. Chọn đúng khổ giấy tương ứng: `10 × 15 cm` hoặc `A4`.
2. Chọn **Actual size**, **100%** hoặc **Kích thước thực**.
3. Tắt **Fit to page**, **Scale to fit** hoặc tùy chọn tự co giãn tương đương.
4. Không bật chế độ borderless nếu máy in tự phóng nội dung để bù mép giấy.
5. In thử một tờ và đo kích thước ảnh trước khi in số lượng lớn.

PDF giúp mô tả kích thước trang chính xác, nhưng driver máy in vẫn có thể tự áp dụng scale. Vì vậy PhotoVisa không thể bảo đảm kích thước giấy thực tế nếu driver hoặc máy in ghi đè lựa chọn 100%.

## Quyền riêng tư

PDF được tạo hoàn toàn trong trình duyệt:

- không upload ảnh lên server;
- không chứa tên file nguồn;
- không chứa landmark hoặc hình học khuôn mặt;
- không thêm metadata nhận dạng người dùng;
- receipt chỉ lưu metadata đầu ra an toàn trong phiên hiện tại.

## Cấu trúc kỹ thuật

`src/pdf-jpeg.js` tạo PDF 1.4 một trang với năm object:

1. Catalog;
2. Pages;
3. Page và `MediaBox`;
4. content stream vẽ ảnh toàn trang;
5. JPEG image XObject dùng `/DCTDecode`.

Bảng `xref` được tính theo byte offset thực. Không có thư viện PDF runtime hoặc dependency mới.

`src/print-sheet-pdf.js` gọi `createPrintSheetBlob()` để lấy JPEG đã được kiểm thử, bọc JPEG vào PDF, tải file và ghi receipt `print-sheet-pdf`.

## Kiểm thử

Unit tests kiểm tra:

- chuyển mm sang point;
- `MediaBox` 10×15 và A4;
- image width/height;
- JPEG stream;
- từng xref offset;
- `startxref`;
- filename;
- receipt và privacy flags;
- validation input.

Chromium E2E tải PDF thật, đọc lại byte, xác nhận `%PDF-1.4`, `MediaBox`, JPEG 1181×1772, JFIF 300 DPI và receipt **PDF in**.
