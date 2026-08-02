import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

function parseJsonc(text) {
  return JSON.parse(text.replace(/^\s*\/\/.*$/gm, ''));
}

test('Cloudflare assets config is committed and excludes development dependencies', async () => {
  const [configText, ignoreText] = await Promise.all([
    readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'),
    readFile(new URL('../.assetsignore', import.meta.url), 'utf8'),
  ]);

  const config = parseJsonc(configText);
  assert.equal(config.name, 'idphoto');
  assert.equal(config.assets?.directory, '.');
  assert.match(ignoreText, /^node_modules\/$/m);
  assert.match(ignoreText, /^\.wrangler\/$/m);
  assert.match(ignoreText, /^tests\/$/m);
  assert.match(ignoreText, /^\.github\/$/m);
});
