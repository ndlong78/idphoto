# Print-ready PDF export

PhotoVisa có thể xuất cùng một bố cục tờ in dưới hai định dạng:

- **JPEG 300 DPI** — tải một tờ, phù hợp để gửi tiệm ảnh hoặc dùng trong phần mềm xử lý ảnh;
- **PDF đúng khổ** — phù hợp khi in trực tiếp, có thể tự chia tối đa 60 ảnh thành nhiều trang.

## Điều khiển số lượng

- **Số bản / trang** quyết định bố cục của trang đầy và bản xem trước.
- **Tổng ảnh PDF** quyết định tổng số ảnh cần in.

Ví dụ, khi bố cục chứa sáu ảnh mỗi trang và tổng số ảnh là 14, PDF được chia thành:

```text
6 + 6 + 2
```

Hai trang đầu dùng cùng bố cục sáu ảnh. Trang cuối chứa hai ảnh và được căn giữa bằng chính layout engine của tờ in.

JPEG vẫn chỉ tải một trang theo lựa chọn **Số bản / trang**.

## Kích thước trang

PDF sử dụng đơn vị point theo chuẩn PDF, với `72 point = 1 inch`.

| Khổ | Hướng | MediaBox xấp xỉ |
| --- | --- | --- |
| 10 × 15 cm | Dọc | `283.4646 × 425.1969 pt` |
| 10 × 15 cm | Ngang | `425.1969 × 283.4646 pt` |
| A4 | Dọc | `595.2756 × 841.8898 pt` |
| A4 | Ngang | `841.8898 × 595.2756 pt` |

Mỗi JPEG tờ in 300 DPI được nhúng nguyên vẹn dưới dạng `/DCTDecode` và phủ toàn bộ trang. PDF không chạy một layout engine khác, không crop lại ảnh và không thay đổi dấu cắt.

## Tái sử dụng trang giống nhau

Các trang có cùng số ảnh dùng chung một JPEG image XObject. Với phân bổ `6 + 6 + 2`, PDF chỉ nhúng:

1. một JPEG cho bố cục sáu ảnh;
2. một JPEG cho bố cục hai ảnh.

Hai page đầu cùng tham chiếu JPEG sáu ảnh. Cách này tránh nhân đôi byte ảnh cho mọi trang giống nhau và giảm bộ nhớ cũng như kích thước file.

Trong trường hợp tổng số ảnh là bội số chính xác của số ảnh mỗi trang, toàn bộ PDF chỉ cần một JPEG XObject dù có nhiều page.

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

Telemetry và receipt chỉ ghi tổng số ảnh, số trang và thông tin đầu ra. Chúng không chứa byte ảnh hoặc dữ liệu khuôn mặt.

## Cấu trúc kỹ thuật

`src/pdf-jpeg.js` tạo PDF 1.4 với:

1. Catalog;
2. Pages tree;
3. một Page object cho mỗi trang;
4. một content stream dùng chung;
5. một JPEG image XObject cho mỗi bố cục trang duy nhất.

Bảng `xref` được tính theo byte offset thực. Không có thư viện PDF runtime hoặc dependency mới.

`src/print-sheet-pagination.js` tính `pageCopies`, trang cuối và các số lượng trang duy nhất. `src/print-sheet-pdf.js` chỉ gọi `createPrintSheetBlob()` cho từng bố cục duy nhất, sau đó xây page tree và ghi receipt `print-sheet-pdf`.

## Kiểm thử

Unit tests kiểm tra:

- pagination và giới hạn 60 ảnh;
- chuyển mm sang point;
- page tree và `/Count`;
- tái sử dụng JPEG XObject;
- `MediaBox` 10×15 và A4;
- image width/height và JPEG stream;
- từng xref offset và `startxref`;
- filename một trang/nhiều trang;
- receipt, số ảnh, số trang và privacy flags;
- validation khi các trang không đồng nhất.

Chromium E2E tải PDF một trang và PDF ba trang thật, đọc lại byte, xác nhận `%PDF-1.4`, `MediaBox`, page count, hai JPEG 1181×1772 ở 300 DPI và receipt **PDF in**.
