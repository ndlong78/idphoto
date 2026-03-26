import test from 'node:test';
import assert from 'node:assert/strict';

import { validateAiSourceVersions } from '../src/ai.js';

test('ai sources: version pinning check phải pass', () => {
  assert.doesNotThrow(() => validateAiSourceVersions());
});
