import test from 'node:test';
import assert from 'node:assert/strict';
import { nextStep } from '../src/pipeline.js';

test('pipeline moves from idle to loading_libs', () => {
  assert.equal(nextStep('idle'), 'loading_libs');
});

test('pipeline keeps render_done as terminal state', () => {
  assert.equal(nextStep('render_done'), 'render_done');
});
