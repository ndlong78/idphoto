function freezeChecks(items) {
  return Object.freeze(items.map((item) => Object.freeze({ ...item })));
}

function freezeProfile(profile) {
  return Object.freeze({
    horizontalCenterTolerance: 0.08,
    faceAreaRange: null,
    headHeightRange: null,
    eyeLineFromTopRange: null,
    manualChecks: Object.freeze([]),
    supportLevel: 'official',
    scopeNotice: null,
    ...profile,
  });
}

export const GENERIC_PROFILE = freezeProfile({
  key: 'generic',
  sourceUrl: null,
  supportLevel: 'generic',
  scopeNotice: 'Preset này chưa có bộ quy tắc hình học chính thức trong ứng dụng.',
  manualChecks: freezeChecks([
    { id: 'pose', label: 'Tư thế và biểu cảm', message: 'Kiểm tra người chụp nhìn thẳng, biểu cảm phù hợp và mắt nhìn rõ.' },
    { id: 'background', label: 'Phông nền', message: 'Kiểm tra màu nền, bóng đổ và vật thể phía sau theo yêu cầu của hồ sơ nhận ảnh.' },
    { id: 'appearance', label: 'Phụ kiện che mặt', message: 'Kiểm tra kính, tóc, mũ hoặc vật dụng không che các đặc điểm nhận dạng.' },
  ]),
});

export const COMPLIANCE_PROFILES = Object.freeze({
  'passport-vn': freezeProfile({
    key: 'passport-vn',
    sourceUrl: 'https://dichvucong.bocongan.gov.vn/bocongan/tintuc/chitiet?matin=141',
    supportLevel: 'official-with-app-tolerance',
    scopeNotice: 'Nguồn chính thức quy định ảnh hộ chiếu Việt Nam 4×6; các dải cảnh báo quanh giá trị mục tiêu là tolerance của ứng dụng.',
    // Nguồn chính thức nêu khuôn mặt chiếm khoảng 75% diện tích ảnh.
    // Dải ±10 điểm phần trăm là tolerance cảnh báo của ứng dụng, không phải
    // ngưỡng chấp nhận chính thức của cơ quan tiếp nhận.
    faceAreaRange: Object.freeze({ min: 0.65, max: 0.85, target: 0.75, approximate: true }),
    // Từ yêu cầu: khoảng cách mắt→mép trên ≈ 2/3 khoảng cách mắt→mép dưới.
    // Suy ra eye line mục tiêu ≈ 40% chiều cao tính từ mép trên.
    eyeLineFromTopRange: Object.freeze({ min: 0.35, max: 0.45, target: 0.40, approximate: true }),
    manualChecks: freezeChecks([
      { id: 'recent', label: 'Ảnh mới chụp', message: 'Ảnh cần được chụp trong vòng 6 tháng.' },
      { id: 'pose', label: 'Mặt nhìn thẳng', message: 'Kiểm tra mặt nhìn thẳng, lộ hai vành tai và đầu để trần.' },
      { id: 'glasses', label: 'Kính mắt', message: 'Kiểm tra ảnh không đeo kính màu và mắt nhìn rõ.' },
      { id: 'background', label: 'Phông nền trắng', message: 'Kiểm tra nền trắng, đồng đều và không có bóng hoặc vật thể.' },
    ]),
  }),

  cccd: freezeProfile({
    key: 'vn-3x4-reference',
    sourceUrl: 'https://dichvucong.gov.vn/p/home/dvc-chi-tiet-thu-tuc-nganh-doc.html?ma_thu_tuc=1.001247',
    supportLevel: 'reference-only',
    scopeNotice: 'Thủ tục cấp thẻ căn cước chụp ảnh khuôn mặt tại cơ quan thu nhận; preset 30×40 mm chỉ là ảnh 3×4 dùng chung cho hồ sơ khác.',
    manualChecks: freezeChecks([
      { id: 'scope', label: 'Không phải ảnh cấp căn cước', message: 'Cơ quan quản lý căn cước trực tiếp chụp ảnh khuôn mặt. Không dùng file này để tự thay thế bước thu nhận ảnh căn cước.' },
      { id: 'destination', label: 'Xác nhận hồ sơ nhận ảnh', message: 'Hỏi cơ quan nhận hồ sơ xem họ có yêu cầu ảnh 3×4, nền, thời hạn chụp hoặc trang phục cụ thể hay không.' },
      { id: 'pose', label: 'Tư thế', message: 'Kiểm tra đầu và vai thẳng, mặt nhìn rõ và không bị che.' },
    ]),
  }),

  'us-visa': freezeProfile({
    key: 'us-visa',
    sourceUrl: 'https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/photos/photo-composition-template.html',
    supportLevel: 'official',
    scopeNotice: 'Dải chiều cao đầu và vị trí mắt lấy trực tiếp từ mẫu bố cục ảnh của Bộ Ngoại giao Hoa Kỳ.',
    headHeightRange: Object.freeze({ min: 0.50, max: 0.69, approximate: false }),
    // Nguồn quy định mắt cách đáy 56–69% chiều cao ảnh, tương đương
    // 31–44% tính từ mép trên.
    eyeLineFromTopRange: Object.freeze({ min: 0.31, max: 0.44, approximate: false }),
    manualChecks: freezeChecks([
      { id: 'recent', label: 'Ảnh mới chụp', message: 'Ảnh cần được chụp trong vòng 6 tháng.' },
      { id: 'pose', label: 'Tư thế và biểu cảm', message: 'Kiểm tra mặt nhìn thẳng, biểu cảm trung tính và hai mắt mở.' },
      { id: 'glasses', label: 'Không đeo kính', message: 'Ảnh visa Mỹ thông thường không được đeo kính.' },
      { id: 'background', label: 'Nền trắng hoặc trắng ngà', message: 'Kiểm tra nền trơn, trắng hoặc trắng ngà, không có bóng.' },
    ]),
  }),

  schengen: freezeProfile({
    key: 'schengen-source-backed',
    sourceUrl: 'https://www.eeas.europa.eu/kenya/travel-study_en',
    supportLevel: 'official-manual-only',
    scopeNotice: 'Nguồn EU xác nhận ảnh màu 35×45 mm, toàn mặt, nền sáng và không quá 6 tháng; ứng dụng không tự đặt tỷ lệ đầu hoặc đường mắt.',
    manualChecks: freezeChecks([
      { id: 'recent', label: 'Ảnh không quá 6 tháng', message: 'Kiểm tra ảnh được chụp trong vòng 6 tháng.' },
      { id: 'colour', label: 'Ảnh màu', message: 'Kiểm tra ảnh là ảnh màu.' },
      { id: 'pose', label: 'Toàn mặt', message: 'Kiểm tra khuôn mặt nhìn trực diện và hiện đầy đủ.' },
      { id: 'background', label: 'Nền sáng', message: 'Kiểm tra ảnh được chụp trên nền sáng và không gây nhầm với khuôn mặt.' },
      { id: 'local-rules', label: 'Yêu cầu của nước tiếp nhận', message: 'Xác nhận thêm hướng dẫn của đại sứ quán hoặc trung tâm tiếp nhận của quốc gia Schengen đang nộp hồ sơ.' },
    ]),
  }),

  'uk-visa': freezeProfile({
    key: 'uk-digital-not-supported',
    sourceUrl: 'https://www.gov.uk/guidance/how-to-take-a-photo-for-a-visa-application-or-permission',
    supportLevel: 'not-supported-as-official-output',
    scopeNotice: 'Hướng dẫn UK hiện yêu cầu ảnh số tối thiểu 600×750 px, JPEG, dọc và không chỉnh/crop bằng phần mềm; preset 35×45 mm không phải đầu ra UK chính thức.',
    manualChecks: freezeChecks([
      { id: 'scope', label: 'Không dùng như ảnh UK chính thức', message: 'Ảnh UK hiện hành cần được nộp theo luồng ảnh số của GOV.UK; không dùng bản 35×45 đã crop/chỉnh từ ứng dụng này để thay thế.' },
      { id: 'digital-format', label: 'Ảnh số UK', message: 'Ảnh phải tối thiểu 600×750 px, từ 50 KB đến 6 MB, định dạng JPG/JPEG và theo chiều dọc.' },
      { id: 'unaltered', label: 'Không chỉnh sửa', message: 'Hướng dẫn UK yêu cầu ảnh rõ nét, đủ sáng và không bị chỉnh bằng phần mềm hoặc bộ lọc.' },
      { id: 'pose', label: 'Tư thế và nền', message: 'Kiểm tra nhìn thẳng, biểu cảm bình thường, mắt mở và nền sáng trơn, không có bóng.' },
    ]),
  }),

  japan: freezeProfile({
    key: 'japan-visa-source-backed',
    sourceUrl: 'https://www.hcmcgj.vn.emb-japan.go.jp/itpr_vi/visa_quacanh.html',
    supportLevel: 'official-manual-only',
    scopeNotice: 'Tổng Lãnh sự quán Nhật Bản tại TP.HCM xác nhận ảnh visa 45×35 mm và chụp trong vòng 6 tháng; nguồn không công bố tỷ lệ đầu hoặc đường mắt để tự động hóa.',
    manualChecks: freezeChecks([
      { id: 'recent', label: 'Ảnh không quá 6 tháng', message: 'Kiểm tra ảnh được chụp trong vòng 6 tháng trở lại.' },
      { id: 'size', label: 'Kích thước 35×45 mm', message: 'Preset tạo ảnh rộng 35 mm và cao 45 mm theo yêu cầu được công bố.' },
      { id: 'local-rules', label: 'Hồ sơ cụ thể', message: 'Đối chiếu thêm checklist của loại visa và cơ quan lãnh sự nơi nộp hồ sơ.' },
    ]),
  }),
});

export const DOCUMENT_PRESET_LABELS = Object.freeze({
  cccd: Object.freeze({
    name: '🪪 Ảnh 3×4 Việt Nam',
    size: '30 × 40 mm · tùy hồ sơ',
  }),
  'uk-visa': Object.freeze({
    name: '🖼️ Ảnh 35×45 chung',
    size: 'Không dùng cho UK digital',
  }),
});

export function applyDocumentPresetLabels(doc = globalThis.document) {
  if (!doc?.querySelector) return;
  for (const [formatKey, label] of Object.entries(DOCUMENT_PRESET_LABELS)) {
    const button = doc.querySelector(`[data-fmt="${formatKey}"]`);
    if (!button) continue;
    const name = button.querySelector?.('.fn');
    const size = button.querySelector?.('.fs');
    if (name) name.textContent = label.name;
    if (size) size.textContent = label.size;
    button.setAttribute?.('title', label.size);
  }
}

function autoApplyDocumentPresetLabels() {
  if (typeof document === 'undefined') return;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => applyDocumentPresetLabels(document), { once: true });
  } else {
    applyDocumentPresetLabels(document);
  }
}

autoApplyDocumentPresetLabels();
