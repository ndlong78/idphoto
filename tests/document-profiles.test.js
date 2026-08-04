import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyDocumentPresetLabels,
  COMPLIANCE_PROFILES,
  DOCUMENT_PRESET_LABELS,
} from '../src/document-profiles.js';

function checkById(profile, id) {
  return profile.manualChecks.find((check) => check.id === id);
}

test('cccd được hạ thành preset ảnh 3x4 tham khảo, không nhận là ảnh căn cước chính thức', () => {
  const profile = COMPLIANCE_PROFILES.cccd;
  assert.equal(profile.key, 'vn-3x4-reference');
  assert.equal(profile.supportLevel, 'reference-only');
  assert.equal(profile.faceAreaRange, null);
  assert.equal(profile.headHeightRange, null);
  assert.equal(profile.eyeLineFromTopRange, null);
  assert.match(profile.scopeNotice, /chụp ảnh khuôn mặt tại cơ quan thu nhận/);
  assert.match(checkById(profile, 'scope').message, /Không dùng file này/);
});

test('uk-visa không còn được mô tả như preset 35x45 chính thức', () => {
  const profile = COMPLIANCE_PROFILES['uk-visa'];
  assert.equal(profile.key, 'uk-digital-not-supported');
  assert.equal(profile.supportLevel, 'not-supported-as-official-output');
  assert.match(profile.scopeNotice, /600×750 px/);
  assert.match(checkById(profile, 'unaltered').message, /không bị chỉnh/);
  assert.equal(DOCUMENT_PRESET_LABELS['uk-visa'].name, '🖼️ Ảnh 35×45 chung');
});

test('japan chỉ mã hóa kích thước và thời hạn có nguồn, không thêm tỷ lệ đầu hoặc mắt', () => {
  const profile = COMPLIANCE_PROFILES.japan;
  assert.equal(profile.key, 'japan-visa-source-backed');
  assert.equal(profile.supportLevel, 'official-manual-only');
  assert.equal(profile.faceAreaRange, null);
  assert.equal(profile.headHeightRange, null);
  assert.equal(profile.eyeLineFromTopRange, null);
  assert.match(checkById(profile, 'recent').message, /6 tháng/);
  assert.match(checkById(profile, 'size').message, /35 mm.*45 mm/);
});

test('schengen có checklist nguồn chính thức nhưng không có ngưỡng hình học tự tạo', () => {
  const profile = COMPLIANCE_PROFILES.schengen;
  assert.equal(profile.supportLevel, 'official-manual-only');
  assert.equal(profile.faceAreaRange, null);
  assert.equal(profile.headHeightRange, null);
  assert.equal(profile.eyeLineFromTopRange, null);
  assert.ok(checkById(profile, 'colour'));
  assert.ok(checkById(profile, 'background'));
  assert.ok(checkById(profile, 'local-rules'));
});

test('applyDocumentPresetLabels thay nhãn CCCD và UK mà không phụ thuộc DOM thật', () => {
  const elements = new Map();
  for (const key of ['cccd', 'uk-visa']) {
    const name = { textContent: '' };
    const size = { textContent: '' };
    const attributes = {};
    const button = {
      querySelector(selector) {
        if (selector === '.fn') return name;
        if (selector === '.fs') return size;
        return null;
      },
      setAttribute(attr, value) {
        attributes[attr] = value;
      },
      name,
      size,
      attributes,
    };
    elements.set(key, button);
  }

  const doc = {
    querySelector(selector) {
      const match = selector.match(/\[data-fmt="([^"]+)"\]/);
      return match ? elements.get(match[1]) ?? null : null;
    },
  };

  applyDocumentPresetLabels(doc);

  assert.equal(elements.get('cccd').name.textContent, '🪪 Ảnh 3×4 Việt Nam');
  assert.equal(elements.get('cccd').size.textContent, '30 × 40 mm · tùy hồ sơ');
  assert.equal(elements.get('uk-visa').name.textContent, '🖼️ Ảnh 35×45 chung');
  assert.equal(elements.get('uk-visa').attributes.title, 'Không dùng cho UK digital');
});
