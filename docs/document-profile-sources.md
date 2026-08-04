# Document profile source ledger

Ngày kiểm chứng gần nhất: **2026-08-04**

Tài liệu này ghi rõ nguồn nào đang được dùng cho từng preset, phần nào được mã hóa thành phép đo tự động và phần nào chỉ được hiển thị dưới dạng checklist thủ công.

## Nguyên tắc

1. Chỉ tạo dải số tự động khi nguồn chính thức công bố số đo hoặc quan hệ hình học đủ rõ.
2. Khi ứng dụng tự thêm tolerance quanh một giá trị mục tiêu, UI phải ghi `Ước lượng`.
3. Yêu cầu bằng chữ như biểu cảm, tóc, kính, nền hoặc thời hạn chụp được giữ ở checklist thủ công.
4. Không suy rộng yêu cầu của một quốc gia hoặc một loại hồ sơ sang preset khác.
5. Link nguồn không đồng nghĩa ảnh chắc chắn được cơ quan tiếp nhận chấp thuận.

## Hộ chiếu Việt Nam — `passport-vn`

Nguồn: Cổng Dịch vụ công Bộ Công an, hướng dẫn quy chuẩn ảnh 4×6.

- URL: https://dichvucong.bocongan.gov.vn/bocongan/tintuc/chitiet?matin=141
- Nguồn nêu ảnh 4×6, chụp không quá 6 tháng, khuôn mặt khoảng 75% diện tích ảnh và quan hệ khoảng cách đường mắt với hai mép ảnh.
- Ứng dụng mã hóa mục tiêu 75% và vị trí đường mắt 40% tính từ mép trên.
- Dải quanh hai mục tiêu là tolerance cảnh báo của ứng dụng, không phải dải chấp thuận chính thức.

## Ảnh 3×4 Việt Nam — key kỹ thuật `cccd`

Nguồn: Cổng Dịch vụ công Quốc gia, thủ tục cấp thẻ căn cước cho người từ đủ 14 tuổi.

- URL: https://dichvucong.gov.vn/p/home/dvc-chi-tiet-thu-tuc-nganh-doc.html?ma_thu_tuc=1.001247
- Quy trình hiện hành cho biết cán bộ thu nhận tiến hành chụp ảnh khuôn mặt tại điểm làm thủ tục.
- Vì vậy preset 30×40 mm không được gọi là ảnh CCCD chính thức nữa.
- Preset được giữ như tiện ích ảnh 3×4 dùng chung; người dùng phải xác nhận yêu cầu của hồ sơ nhận ảnh.
- Không có dải diện tích mặt, chiều cao đầu hoặc đường mắt chính thức trong ứng dụng.

## Visa Hoa Kỳ — `us-visa`

Nguồn: U.S. Department of State, Photo Composition Template.

- URL: https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/photos/photo-composition-template.html
- Ứng dụng giữ dải chiều cao đầu 50–69% chiều cao ảnh.
- Ứng dụng giữ dải đường mắt 31–44% tính từ mép trên, quy đổi từ khoảng cách mắt tới đáy ảnh trong nguồn.
- Các tiêu chí biểu cảm, kính và nền vẫn là checklist thủ công.

## Schengen — `schengen`

Nguồn pháp lý và nguồn hướng dẫn EU:

- Visa Code hợp nhất trên EUR-Lex: https://eur-lex.europa.eu/eli/reg/2009/810/2024-06-28/eng
- Hướng dẫn ảnh của European External Action Service: https://www.eeas.europa.eu/kenya/travel-study_en

Phạm vi mã hóa:

- Kích thước preset: rộng 35 mm × cao 45 mm.
- Checklist thủ công: ảnh màu, toàn mặt, nền sáng, chụp không quá 6 tháng.
- Visa Code dẫn chiếu chuẩn ICAO cho ảnh, nhưng registry không tự tạo tỷ lệ đầu hoặc đường mắt từ các ví dụ không có số rõ trên nguồn đang liên kết.
- Người dùng vẫn phải kiểm tra hướng dẫn của quốc gia Schengen hoặc trung tâm tiếp nhận cụ thể.

## Ảnh 35×45 dùng chung — key kỹ thuật `uk-visa`

Nguồn: GOV.UK, hướng dẫn ảnh số cho visa application or permission.

- URL: https://www.gov.uk/guidance/how-to-take-a-photo-for-a-visa-application-or-permission
- Hướng dẫn hiện hành yêu cầu ảnh số ít nhất 600×750 px, 50 KB–6 MB, JPG/JPEG, dọc và không chỉnh sửa bằng phần mềm.
- Vì editor hiện crop và xử lý ảnh, preset 35×45 mm không được gọi là ảnh Visa Anh chính thức nữa.
- Key kỹ thuật `uk-visa` được giữ tạm để tránh phá vỡ state/test cũ, nhưng nhãn UI đổi thành `Ảnh 35×45 chung`.
- Không có dải hình học UK nào được tự động hóa trong preset này.

## Visa Nhật Bản — `japan`

Nguồn: Tổng Lãnh sự quán Nhật Bản tại Thành phố Hồ Chí Minh.

- URL: https://www.hcmcgj.vn.emb-japan.go.jp/itpr_vi/visa_quacanh.html
- Nguồn công bố ảnh 4,5 cm × 3,5 cm, chụp trong vòng 6 tháng.
- Preset dùng rộng 35 mm × cao 45 mm.
- Không tự tạo dải diện tích mặt, chiều cao đầu hoặc đường mắt vì nguồn liên kết không công bố các số đó.
- Checklist của từng loại visa và cơ quan lãnh sự vẫn cần được kiểm tra riêng.

## Chu kỳ rà soát

- Rà lại nguồn ít nhất mỗi 6 tháng hoặc trước khi phát hành thay đổi lớn về preset.
- Khi nguồn đổi URL nhưng nội dung chưa đổi, cập nhật URL và ngày kiểm chứng.
- Khi yêu cầu thay đổi, cập nhật registry, test và nội dung UI trong cùng một PR.
