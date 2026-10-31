import test from 'node:test';
import assert from 'node:assert/strict';
import { NEU_COLORS, SHADOW_PRESETS, contrastRatio, interWeight, withAlpha } from './neuTheme';

test('neutral surface family matches the reference (surface === background)', () => {
  assert.equal(NEU_COLORS.dark.bg, '#202228');
  assert.equal(NEU_COLORS.dark.shadowLight, '#30343D');
  assert.equal(NEU_COLORS.dark.shadowDark, '#15171B');
  assert.equal(NEU_COLORS.light.bg, '#E8EDF4');
  assert.equal(NEU_COLORS.light.shadowDark, '#D1D9E6');
  for (const m of ['light', 'dark'] as const) assert.equal(NEU_COLORS[m].bg, NEU_COLORS[m].surface);
});

test('text, muted text, accent text and status colours reach WCAG AA (4.5:1) on the surface', () => {
  for (const m of ['light', 'dark'] as const) {
    const c = NEU_COLORS[m];
    for (const k of ['text', 'textMuted', 'accentText', 'success', 'warning', 'danger'] as const) {
      assert.ok(contrastRatio(c[k], c.surface) >= 4.5, `${m}.${k} ${contrastRatio(c[k], c.surface).toFixed(2)}`);
    }
  }
});

test('foreground on filled accent and danger surfaces is readable', () => {
  for (const m of ['light', 'dark'] as const) {
    const c = NEU_COLORS[m];
    assert.ok(contrastRatio(c.onAccent, c.accent) >= 4.5, `${m} onAccent`);
    assert.ok(contrastRatio(c.onDanger, c.danger) >= 4.5, `${m} onDanger`);
  }
});

test('dark accent uses the electric-to-royal blue gradient', () => {
  assert.equal(NEU_COLORS.dark.accent, '#3B82FF');
  assert.equal(NEU_COLORS.dark.accentEnd, '#5B48F2');
});

test('shadow presets: raised are outset, inset are inset, subtle is lighter than standard', () => {
  assert.equal(SHADOW_PRESETS.raised.inset, false);
  assert.equal(SHADOW_PRESETS.insetField.inset, true);
  assert.ok(SHADOW_PRESETS.raisedSubtle.offset < SHADOW_PRESETS.raised.offset);
  assert.ok(SHADOW_PRESETS.raisedSubtle.opacity < 1);
});

test('interWeight maps CSS weights to the loaded Inter weights', () => {
  assert.equal(interWeight(undefined), 400);
  assert.equal(interWeight('500'), 500);
  assert.equal(interWeight('600'), 600);
  assert.equal(interWeight('bold'), 700);
  assert.equal(interWeight('800'), 700);
});

test('withAlpha builds rgba strings', () => {
  assert.equal(withAlpha('#FF0000', 0.5), 'rgba(255,0,0,0.5)');
});
