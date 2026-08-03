import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyAutoCompositionPlan,
  buildAutoCompositionPlan,
  captureCompositionState,
  compositionStateMatches,
  restoreCompositionState,
} from '../src/composition-fix.js';

const image = { width: 1200, height: 1600 };
const vietnamProfile = {
  faceAreaRange: { min: 0.65, max: 0.85, target: 0.75 },
  headHeightRange: null,
  eyeLineFromTopRange: { min: 0.35, max: 0.45, target: 0.4 },
};
const usProfile = {
  faceAreaRange: null,
  headHeightRange: { min: 0.5, max: 0.69 },
  eyeLineFromTopRange: { min: 0.31, max: 0.44 },
};
const genericProfile = {
  faceAreaRange: null,
  headHeightRange: null,
  eyeLineFromTopRange: null,
};

function makeSnapshot(overrides = {}) {
  return {
    origImg: image,
    curFmt: 'passport-vn',
    frame: { x: 20, y: 30, w: 400, h: 600 },
    crop: { x: -50, y: -80, scale: 0.4 },
    faceData: {
      faceCount: 1,
      box: { x: 300, y: 300, width: 300, height: 400 },
      eyeLineY: 430,
      headBox: null,
    },
    faceAdjust: { yOffsetPct: 3 },
    resultFaceOffsetPct: { x: 4, y: -2 },
    ...overrides,
  };
}

test('Vietnam plan targets face area, horizontal center and eye line', () => {
  const snapshot = makeSnapshot();
  const plan = buildAutoCompositionPlan({ snapshot, profile: vietnamProfile });

  assert.equal(plan.ok, true);
  assert.equal(plan.changed, true);
  assert.ok(plan.changes.includes('scale-face-area'));
  assert.ok(plan.changes.includes('align-eye-line'));

  const projectedCenterX = plan.next.crop.x + (300 + 150) * plan.next.crop.scale;
  assert.ok(Math.abs(projectedCenterX - 220) < 1e-6);

  const projectedEyeY = plan.next.crop.y + 430 * plan.next.crop.scale;
  assert.ok(Math.abs(projectedEyeY - 270) < 1e-6);

  const area = (300 * 400 * plan.next.crop.scale ** 2) / (400 * 600);
  assert.ok(Math.abs(area - 0.75) < 1e-9);
});

test('US plan without a head box preserves zoom but aligns center and eye midpoint', () => {
  const snapshot = makeSnapshot({ curFmt: 'us-visa' });
  const plan = buildAutoCompositionPlan({ snapshot, profile: usProfile });

  assert.equal(plan.ok, true);
  assert.equal(plan.next.crop.scale, 0.4);
  assert.ok(plan.limitations.some((item) => /Chiều cao đầu/.test(item)));

  const projectedEyeY = plan.next.crop.y + 430 * plan.next.crop.scale;
  const target = 30 + ((0.31 + 0.44) / 2) * 600;
  assert.ok(Math.abs(projectedEyeY - target) < 1e-6);
});

test('generic profile preserves zoom and centers the face vertically', () => {
  const snapshot = makeSnapshot({ curFmt: 'schengen' });
  const plan = buildAutoCompositionPlan({ snapshot, profile: genericProfile });

  assert.equal(plan.next.crop.scale, 0.4);
  assert.ok(plan.changes.includes('center-vertical'));
  const centerY = plan.next.crop.y + (300 + 200) * 0.4;
  assert.ok(Math.abs(centerY - 330) < 1e-6);
});

test('rejects missing or multiple faces', () => {
  assert.equal(
    buildAutoCompositionPlan({
      snapshot: makeSnapshot({ faceData: null }),
      profile: vietnamProfile,
    }).ok,
    false,
  );

  const many = makeSnapshot();
  many.faceData.faceCount = 2;
  assert.equal(
    buildAutoCompositionPlan({ snapshot: many, profile: vietnamProfile }).code,
    'multiple-faces',
  );
});

test('scale is clamped so the detected face remains inside the frame', () => {
  const snapshot = makeSnapshot({
    frame: { x: 0, y: 0, w: 200, h: 200 },
    faceData: {
      faceCount: 1,
      box: { x: 10, y: 10, width: 50, height: 190 },
      eyeLineY: 60,
    },
  });
  const plan = buildAutoCompositionPlan({ snapshot, profile: vietnamProfile });

  assert.ok(plan.next.crop.scale <= (200 - 10) / 190 + 1e-9);
  const top = plan.next.crop.y + 10 * plan.next.crop.scale;
  const bottom = plan.next.crop.y + 200 * plan.next.crop.scale;
  assert.ok(top >= 5 - 1e-6);
  assert.ok(bottom <= 195 + 1e-6);
});

test('apply and one-level restore preserve the previous composition', () => {
  const snapshot = makeSnapshot();
  const before = captureCompositionState(snapshot);
  const plan = buildAutoCompositionPlan({ snapshot, profile: vietnamProfile });

  assert.equal(applyAutoCompositionPlan(snapshot, plan), true);
  const after = captureCompositionState(snapshot);
  assert.equal(compositionStateMatches(snapshot, after), true);

  assert.equal(restoreCompositionState(snapshot, before), true);
  assert.equal(compositionStateMatches(snapshot, before), true);
});

test('undo becomes invalid after a manual geometry change', () => {
  const snapshot = makeSnapshot();
  const plan = buildAutoCompositionPlan({ snapshot, profile: vietnamProfile });
  applyAutoCompositionPlan(snapshot, plan);
  const after = captureCompositionState(snapshot);

  snapshot.crop.x += 2;
  assert.equal(compositionStateMatches(snapshot, after), false);
});

test('restore refuses a different image or preset', () => {
  const snapshot = makeSnapshot();
  const captured = captureCompositionState(snapshot);

  assert.equal(restoreCompositionState({ ...snapshot, origImg: {} }, captured), false);
  assert.equal(restoreCompositionState({ ...snapshot, curFmt: 'us-visa' }, captured), false);
});
