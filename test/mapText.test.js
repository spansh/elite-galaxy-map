import { describe, expect, it } from 'vitest';
import { DEFAULT_TEXT, MapText, checkText } from '../src/mapText.js';
import { COMMAND_TYPES, validateCommand } from '../src/commands.js';

describe('MapText', () => {
  it('formats the English text with numbers and plurals', () => {
    const mapText = new MapText({}, 'en');
    expect(mapText.format('load')).toBe('Load');
    expect(mapText.format('routeSummary', { start: 'Sol', end: 'Colonia', jumpCount: 1 })).toBe('Sol to Colonia, 1 jump.');
    expect(mapText.format('tradeRouteSummary', { start: 'A', end: 'B', hopCount: 5 })).toBe('A to B, 5 hops.');
    expect(mapText.format('loadingSystemsOfSize', { systemCount: 1234567, loadedMegabytes: 120, totalMegabytes: 182 }))
      .toBe('Loading 1,234,567 systems, 120 MB of 182 MB');
    expect(mapText.format('selectedSystemCoordinates', { x: -9530.5, y: 0, z: 19808.125 })).toBe('-9530.50, 0.00, 19808.13');
  });

  it('uses a page\'s messages and its locale, keeping English for the rest', () => {
    const mapText = new MapText({ load: 'Charger', routeSummary: '{start} → {end}, {jumpCount, plural, one {# saut} other {# sauts}}' }, 'fr');
    expect(mapText.format('load')).toBe('Charger');
    expect(mapText.format('stop')).toBe(DEFAULT_TEXT.stop);
    expect(mapText.format('routeSummary', { start: 'Sol', end: 'Colonia', jumpCount: 1500 })).toBe('Sol → Colonia, 1 500 sauts');
    expect(mapText.formatNumber(1500)).toBe('1 500');
  });

  it('defaults to the browser\'s language', () => {
    expect(new MapText().locale).toBe(globalThis.navigator?.language ?? 'en');
  });

  it('names the key of a mistake', () => {
    expect(() => new MapText({ loadButton: 'Charger' })).toThrow(/Unknown text "loadButton"/);
    expect(() => new MapText({ load: 42 })).toThrow(/text for "load" must be a string/);
    expect(() => new MapText({ routeSummary: '{start to {end}' })).toThrow(/text for "routeSummary" is not a valid ICU message/);
    expect(() => new MapText({}, 'not a locale!')).toThrow(/locale must be a language tag/);
    expect(() => new MapText({}, 42)).toThrow(/locale must be a language tag/);
    expect(() => new MapText({}, ['fr', 'de'])).toThrow(/locale must be a language tag/);
    expect(() => new MapText({ constructor: 'x' })).toThrow(/Unknown text "constructor"/);
    expect(() => checkText(['load'])).toThrow(/must be an object of messages/);
  });

  it('fails as soon as a message uses a placeholder the map doesn\'t give it, or a tag', () => {
    expect(() => new MapText({ legend: 'Légende {n}' })).toThrow(/text for "legend" can't be shown.*placeholders are none/);
    expect(() => new MapText({ routeSummary: '{start} → {end}, {hopCount} étapes' }))
      .toThrow(/text for "routeSummary" can't be shown.*\{start\}, \{end\}, \{jumpCount\}/);
    expect(() => new MapText({ load: '<b>Charger</b>' })).toThrow(/text for "load" can't be shown/);
    expect(() => new MapText({ routeSummary: '{end} ← {start}' })).not.toThrow();
  });

  it('is checked by the setText command', () => {
    expect(() => validateCommand({ type: COMMAND_TYPES.setText, text: { load: 'Charger' }, locale: 'fr' })).not.toThrow();
    expect(() => validateCommand({ type: COMMAND_TYPES.setText, text: { loadButton: 'Charger' } })).toThrow(/Unknown text "loadButton"/);
  });
});
