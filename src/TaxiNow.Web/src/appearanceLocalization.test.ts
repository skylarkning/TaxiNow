import { describe, expect, it } from 'vitest';
import shell from '../index.html?raw';
import { flightDeckTranslations } from './localization.flightdeck';

const bootstrap = shell.match(/<script>([\s\S]*?)<\/script>/)![1]!;

describe('appearance before first paint', () => {
  for (const saved of [null, 'light', 'dark', 'invalid', 'storage-error']) {
    it(`resolves ${saved} before loading the app`, () => {
      const root = { dataset: {} as Record<string, string>, style: { colorScheme: '' } };
      const meta = { content: '' };
      new Function('document', 'localStorage', bootstrap)(
        { documentElement: root, querySelector: () => meta },
         { getItem: () => { if (saved === 'storage-error') throw new Error(); return saved; } }
      );
      const dark = saved === 'dark';
      expect(root.dataset.theme).toBe(dark ? 'dark' : 'light');
      expect(root.style.colorScheme).toBe(dark ? 'dark' : 'only light');
      expect(meta.content).toBe(root.style.colorScheme);
      expect(shell.indexOf(bootstrap)).toBeLessThan(shell.indexOf('<body>'));
    });
  }
});

describe('flight deck translations', () => {
  const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
  for (const [locale, catalog] of Object.entries(flightDeckTranslations)) {
    it(`covers every flight deck phrase and substitution in ${locale}`, () => {
      expect(Object.keys(catalog)).toEqual(Object.keys(flightDeckTranslations.en));
      for (const [key, value] of Object.entries(catalog)) {
        expect(value.trim(), key).not.toBe('');
        expect(placeholders(value), key).toEqual(placeholders(flightDeckTranslations.en[key]!));
      }
    });
  }
  it('uses translated primary controls rather than the English fallback', () => {
    for (const [locale, catalog] of Object.entries(flightDeckTranslations)) {
      if (locale === 'en') continue;
      for (const key of ['flight', 'route', 'maps', 'import', 'profileEmpty', 'savedUsername']) {
        expect(catalog['flightdeck.' + key]).not.toBe(flightDeckTranslations.en['flightdeck.' + key]);
      }
    }
  });
});
