# Live Print Sheet Preview

## Mục tiêu

Bản xem trước giúp người dùng nhìn thấy cách ảnh được xếp trên giấy trước khi tạo file tải xuống. Preview dùng chính layout theo millimeter của `src/print-sheet-layout.js`, vì vậy số bản, hướng giấy, khoảng cách và vị trí ảnh không được tính lại bằng một thuật toán riêng.

## Preview không phải file xuất

Preview và file tải xuống có hai mục đích khác nhau:

- Preview ưu tiên phản hồi nhanh và mức dùng bộ nhớ thấp.
- File tải xuống luôn được tạo lại bởi `src/print-sheet.js` ở JPEG 300 DPI.
- Preview sử dụng `#result-canvas` hiện có thay vì gọi renderer 300 DPI.
- Device pixel ratio của preview bị giới hạn tối đa 2×.
- Cạnh preview tối đa khoảng 320 CSS pixel.

Nhờ đó, việc đổi giấy A4, số bản hoặc khoảng cách không tạo canvas 3.508 × 2.480 pixel liên tục trên điện thoại.

## Các thành phần

### `src/print-sheet-preview.js`

Module thuần phụ trách:

1. chuyển tọa độ giấy và ảnh từ millimeter sang pixel preview;
2. giữ đúng tỷ lệ giấy dọc hoặc ngang;
3. vẽ các bản sao từ canvas kết quả;
4. vẽ placeholder khi ảnh chưa sẵn sàng;
5. vẽ dấu cắt theo cùng tùy chọn của file xuất;
6. ghi metadata debug không nhạy cảm lên `dataset` của canvas.

Metadata chỉ gồm preset, khổ giấy, hướng giấy, số bản, hàng/cột, dấu cắt và revision. Không ghi byte ảnh, tên file nguồn, landmark hoặc hình học khuôn mặt.

### `src/print-sheet-preview-view.js`

Controller tự gắn preview vào panel tờ in và cập nhật khi:

- đổi preset;
- đổi giấy, số bản hoặc khoảng cách;
- bật/tắt dấu cắt;
- thay đổi các slider chỉnh ảnh;
- chọn màu nền;
- zoom, fit, reset hoặc kéo ảnh;
- editor mở lại sau khi chọn ảnh mới;
- viewport thay đổi kích thước.

Một số thao tác render ảnh bất đồng bộ. Controller vẽ ngay và vẽ lại sau các khoảng trễ ngắn để lấy frame kết quả mới nhất, nhưng không chặn luồng export.

## Accessibility

Canvas preview có:

- `role="img"`;
- `aria-label` mô tả khổ giấy, số ảnh và bố cục;
- liên kết tới summary và caption qua `aria-describedby`;
- trạng thái chờ qua vùng `aria-live`.

Thông tin quan trọng vẫn được thể hiện bằng văn bản trong `#print-sheet-summary`; canvas không phải nguồn thông tin duy nhất.

## Kiểm thử

Unit tests kiểm tra:

- tỷ lệ giấy 10 × 15 cm;
- A4 tự xoay ngang;
- giới hạn DPR;
- số lần vẽ ảnh;
- placeholder và dấu cắt;
- validation;
- metadata quyền riêng tư.

Chromium desktop E2E kiểm tra hành trình:

1. upload ảnh;
2. preview hộ chiếu 10 × 15 cm;
3. đổi sang Schengen;
4. đổi số bản;
5. tắt dấu cắt;
6. đổi sang A4;
7. thu viewport còn 390 pixel;
8. xác nhận không có download hoặc receipt được tạo chỉ vì xem preview.
