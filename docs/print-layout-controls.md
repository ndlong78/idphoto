# Print layout controls

PhotoID cho phép dùng cùng một cấu hình bố cục cho live preview, JPEG 300 DPI, PDF một trang và PDF batch.

## Hướng giấy

- **Tự động**: thử cả dọc và ngang rồi chọn hướng có sức chứa cao hơn.
- **Dọc**: ép giấy theo chiều dọc.
- **Ngang**: ép giấy theo chiều ngang.

Summary phân biệt lựa chọn và kết quả thực tế, ví dụ `tự động → dọc` hoặc `ép ngang`.

## Lề giấy

Các mức hỗ trợ: `0`, `2`, `4`, `5`, `8`, `10`, `15`, `20 mm`.

Tăng lề làm giảm vùng xếp ảnh và có thể giảm sức chứa, nhưng không thay đổi kích thước vật lý của từng ảnh.

Mặc định theo giấy:

| Khổ | Lề | Khoảng cách |
| --- | ---: | ---: |
| 10 × 15 cm | 4 mm | 3 mm |
| A4 | 10 mm | 4 mm |

Khi đổi khổ giấy, lề và khoảng cách trở về mặc định của khổ mới. Hướng giấy được giữ cho tới khi người dùng đổi lại.

## Ví dụ Schengen 35 × 45 mm trên giấy 10 × 15 cm

| Cấu hình | Sức chứa | Lưới |
| --- | ---: | ---: |
| Tự động, lề 4 mm | 6 | 2 × 3 |
| Ngang, lề 4 mm | 3 | 3 × 1 |
| Ngang, lề 20 mm | 2 | 2 × 1 |

Với tổng 5 ảnh ở cấu hình cuối, PDF được chia `2 + 2 + 1`. Preview navigator hiển thị đúng từng trang và trang cuối một ảnh.

## Lifecycle

- Đổi preset, khổ giấy, hướng, lề, khoảng cách hoặc số ảnh/trang: preview quay về trang 1.
- Đổi tổng ảnh PDF: giữ trang hiện tại nếu còn hợp lệ, nếu không clamp về trang cuối mới.
- Đổi dấu cắt hoặc chỉnh ảnh: giữ trang hiện tại và render lại.

## Receipt và quyền riêng tư

Receipt JPEG/PDF ghi hướng thực tế và lề để đối chiếu cấu hình sau khi tải.

Các control, preview dataset và receipt không chứa byte ảnh, tên file nguồn, landmark hoặc hình học khuôn mặt.

## Kiểm thử

Unit tests khóa phép tính sức chứa và kích thước ảnh. Chromium E2E kiểm tra UI, preview batch và tải JPEG thật `1772 × 1181 px` ở 300 DPI khi dùng hướng ngang và lề 20 mm.
