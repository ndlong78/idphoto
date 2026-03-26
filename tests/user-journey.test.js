import test from 'node:test';
import assert from 'node:assert/strict';

import { state, validateImageFile } from '../src/state.js';
import { renderResult } from '../src/render.js';
import { download } from '../src/ui.js';

class FakeCanvas {
  constructor() {
    this.width = 0;
    this.height = 0;
    this.style = {};
    this._data = new Uint8ClampedArray(0);
    this._ctx = {
      drawImage: () => {
        const len = this.width * this.height * 4;
        if (this._data.length !== len) this._data = new Uint8ClampedArray(len);
        for (let i = 0; i < this._data.length; i += 4) {
          this._data[i] = 200;
          this._data[i + 1] = 180;
          this._data[i + 2] = 160;
          this._data[i + 3] = 255;
        }
      },
      getImageData: () => ({
        data: new Uint8ClampedArray(this._data),
        width: this.width,
        height: this.height,
      }),
      putImageData: (img) => {
        this._data = new Uint8ClampedArray(img.data);
      },
      clearRect: () => {},
    };
  }

  getContext() {
    return this._ctx;
  }

  toDataURL(mime) {
    return `data:${mime};base64,FAKE_${this.width}x${this.height}`;
  }
}

function makeInput(valueAsNumber) {
  return { valueAsNumber, value: String(valueAsNumber) };
}

test('journey: upload hợp lệ -> AI fallback render -> export', async () => {
  const previousDocument = globalThis.document;

  const controls = {
    bright: makeInput(0),
    contrast: makeInput(0),
    sharp: makeInput(0),
    skin: makeInput(0),
    feather: makeInput(2),
    shadow: makeInput(0),
  };

  let capturedAnchor = null;

  globalThis.document = {
    getElementById: (id) => controls[id] ?? null,
    createElement: (tag) => {
      if (tag === 'canvas') return new FakeCanvas();
      if (tag === 'a') {
        capturedAnchor = {
          download: '',
          href: '',
          clickCalled: false,
          click() {
            this.clickCalled = true;
          },
        };
        return capturedAnchor;
      }
      return { style: {} };
    },
  };

  try {
    const file = { name: 'avatar.jpg', type: 'image/jpeg', size: 1024 * 1024 };
    const validation = validateImageFile(file);
    assert.equal(validation.ok, true, 'Upload JPG hợp lệ phải pass validateImageFile');

    state.origImg = { width: 400, height: 500 };
    state.origFile = file;
    state.aiMaskImg = null; // AI fallback branch
    state.curFmt = 'passport-vn';
    state.bgColor = { r: 255, g: 255, b: 255 };
    state.frame = { x: 0, y: 0, w: 413, h: 531 };
    state.crop = { x: 0, y: 0, scale: 1 };

    const preview = await renderResult(1);
    assert.equal(preview.width, 413);
    assert.equal(preview.height, 531);

    await download('jpeg300');
    assert.ok(capturedAnchor?.clickCalled, 'download() phải trigger click link');
    assert.match(capturedAnchor.download, /photovisa_passport-vn_413x531_300dpi\.jpeg$/);
    assert.match(capturedAnchor.href, /^data:image\/jpeg/);
  } finally {
    globalThis.document = previousDocument;

    state.origImg = null;
    state.origFile = null;
    state.aiMaskImg = null;
    state.curFmt = 'passport-vn';
    state.bgColor = { r: 255, g: 255, b: 255 };
    state.frame = { x: 0, y: 0, w: 0, h: 0 };
    state.crop = { x: 0, y: 0, scale: 1 };
  }
});
