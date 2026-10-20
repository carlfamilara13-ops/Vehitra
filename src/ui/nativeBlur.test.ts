import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { isNativeBlurViewAvailable } from './nativeBlur';

// The probe asks the Expo runtime for the blur view's config, so every case can be exercised
// by shaping `globalThis.expo`: present-and-registered, present-but-missing, absent, and broken.

const originalExpo = (globalThis as { expo?: unknown }).expo;

afterEach(() => {
  (globalThis as { expo?: unknown }).expo = originalExpo;
});

function setExpo(value: unknown): void {
  (globalThis as { expo?: unknown }).expo = value;
}

describe('isNativeBlurViewAvailable', () => {
  it('is true when the running binary registered the ExpoBlur view', () => {
    const seen: Array<[string, string | undefined]> = [];
    setExpo({
      getViewConfig: (moduleName: string, viewName?: string) => {
        seen.push([moduleName, viewName]);
        return moduleName === 'ExpoBlur' && viewName === 'ExpoBlurView' ? { validAttributes: {} } : null;
      },
    });
    assert.equal(isNativeBlurViewAvailable(), true);
    assert.deepEqual(seen, [['ExpoBlur', 'ExpoBlurView']]);
  });

  it('is false when the binary was built without the blur view', () => {
    setExpo({ getViewConfig: () => null });
    assert.equal(isNativeBlurViewAvailable(), false);
  });

  it('is false when the Expo runtime is absent', () => {
    setExpo(undefined);
    assert.equal(isNativeBlurViewAvailable(), false);
  });

  it('is false rather than throwing when getViewConfig is not a function', () => {
    setExpo({});
    assert.equal(isNativeBlurViewAvailable(), false);
  });

  it('is false rather than throwing when getViewConfig throws', () => {
    setExpo({
      getViewConfig: () => {
        throw new Error('runtime unavailable');
      },
    });
    assert.equal(isNativeBlurViewAvailable(), false);
  });
});
