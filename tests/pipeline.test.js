import test from 'node:test';
import assert from 'node:assert/strict';
import { nextStep, STEPS, isValidStep } from '../src/pipeline.js';

// ── nextStep ──────────────────────────────────────────────────────────────────

test('pipeline: idle → loading_libs', () => {
  assert.equal(nextStep(STEPS.IDLE), STEPS.LOADING_LIBS);
});

test('pipeline: loading_libs → detect_face', () => {
  assert.equal(nextStep(STEPS.LOADING_LIBS), STEPS.DETECT_FACE);
});

test('pipeline: detect_face → remove_bg', () => {
  assert.equal(nextStep(STEPS.DETECT_FACE), STEPS.REMOVE_BG);
});

test('pipeline: remove_bg → render_done', () => {
  assert.equal(nextStep(STEPS.REMOVE_BG), STEPS.RENDER_DONE);
});

test('pipeline: render_done là terminal state (giữ nguyên)', () => {
  assert.equal(nextStep(STEPS.RENDER_DONE), STEPS.RENDER_DONE);
});

test('pipeline: step không hợp lệ → reset về idle', () => {
  assert.equal(nextStep('unknown_step'), STEPS.IDLE);
  assert.equal(nextStep(''),             STEPS.IDLE);
});

test('pipeline: chuỗi đầy đủ từ idle đến render_done', () => {
  const order = [STEPS.IDLE, STEPS.LOADING_LIBS, STEPS.DETECT_FACE, STEPS.REMOVE_BG, STEPS.RENDER_DONE];
  let step = STEPS.IDLE;
  for (let i = 1; i < order.length; i++) {
    step = nextStep(step);
    assert.equal(step, order[i], `Bước ${i}: expected ${order[i]}, got ${step}`);
  }
});

// ── isValidStep ───────────────────────────────────────────────────────────────

test('isValidStep: nhận diện đúng các step hợp lệ', () => {
  for (const s of Object.values(STEPS)) {
    assert.equal(isValidStep(s), true, `${s} phải hợp lệ`);
  }
});

test('isValidStep: từ chối step không hợp lệ', () => {
  assert.equal(isValidStep(''),           false);
  assert.equal(isValidStep('IDLE'),       false);  // case-sensitive
  assert.equal(isValidStep('render'),     false);
  assert.equal(isValidStep(undefined),    false);
});

// ── STEPS enum ────────────────────────────────────────────────────────────────

test('STEPS enum: tất cả các giá trị là string không rỗng', () => {
  for (const [key, val] of Object.entries(STEPS)) {
    assert.equal(typeof val, 'string', `STEPS.${key} phải là string`);
    assert.ok(val.length > 0, `STEPS.${key} không được rỗng`);
  }
});

test('STEPS enum: không có giá trị trùng lặp', () => {
  const values = Object.values(STEPS);
  const unique = new Set(values);
  assert.equal(unique.size, values.length, 'STEPS có giá trị bị trùng lặp');
});
