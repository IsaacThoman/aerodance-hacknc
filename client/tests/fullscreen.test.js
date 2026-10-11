import test from 'node:test';
import assert from 'node:assert/strict';
import { readFullscreenState, toggleFullscreen } from '../src/menu/useFullscreen.js';

test('standard fullscreen enters synchronously on the whole document and exits with the right receiver', async () => {
  let requested = false;
  const doc = {
    fullscreenEnabled: true,
    fullscreenElement: null,
    documentElement: {
      requestFullscreen() {
        assert.equal(this, doc.documentElement);
        requested = true;
        doc.fullscreenElement = this;
        return Promise.resolve();
      },
      webkitRequestFullscreen() { assert.fail('prefer the standard API'); },
    },
    exitFullscreen() {
      assert.equal(this, doc);
      doc.fullscreenElement = null;
      return Promise.resolve();
    },
    webkitExitFullscreen() { assert.fail('prefer the standard API'); },
  };
  assert.deepEqual(readFullscreenState(doc), { active: false, supported: true });
  const entering = toggleFullscreen(doc);
  assert.ok(requested, 'do not defer the request beyond the user input handler');
  await entering;
  assert.deepEqual(readFullscreenState(doc), { active: true, supported: true });
  await toggleFullscreen(doc);
  assert.deepEqual(readFullscreenState(doc), { active: false, supported: true });
});

test('older Safari can enter and exit through the prefixed API returning void', () => {
  const doc = {
    webkitFullscreenEnabled: true,
    webkitFullscreenElement: null,
    documentElement: {
      webkitRequestFullscreen() {
        assert.equal(this, doc.documentElement);
        doc.webkitFullscreenElement = this;
      },
    },
    webkitExitFullscreen() {
      assert.equal(this, doc);
      doc.webkitFullscreenElement = null;
    },
  };
  assert.deepEqual(readFullscreenState(doc), { active: false, supported: true });
  assert.equal(toggleFullscreen(doc), undefined);
  assert.deepEqual(readFullscreenState(doc), { active: true, supported: true });
  assert.equal(toggleFullscreen(doc), undefined);
  assert.deepEqual(readFullscreenState(doc), { active: false, supported: true });
});

test('fullscreen is unavailable when the API is missing or browser policy disables it', () => {
  assert.equal(readFullscreenState({ documentElement: {} }).supported, false);
  assert.equal(readFullscreenState({
    fullscreenEnabled: false,
    documentElement: { requestFullscreen() {} },
    exitFullscreen() {},
  }).supported, false);
  assert.equal(readFullscreenState({
    webkitFullscreenEnabled: false,
    documentElement: { webkitRequestFullscreen() {} },
    webkitExitFullscreen() {},
  }).supported, false);
});
