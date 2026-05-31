import {
  getReadableForeground,
  getRelativeLuminance,
  normalizeHexColor,
  parseHexColor,
  rgba
} from '@/lib/helpers/color';

describe('color helpers', () => {
  describe('parseHexColor', () => {
    it('parses 6-digit hex with a leading #', () => {
      expect(parseHexColor('#ff8800')).toEqual({ r: 255, g: 136, b: 0 });
    });

    it('parses 6-digit hex without a leading #', () => {
      expect(parseHexColor('00ff00')).toEqual({ r: 0, g: 255, b: 0 });
    });

    it('expands 3-digit shorthand hex', () => {
      expect(parseHexColor('#f80')).toEqual({ r: 255, g: 136, b: 0 });
    });

    it('trims surrounding whitespace', () => {
      expect(parseHexColor('  #112233  ')).toEqual({ r: 17, g: 34, b: 51 });
    });

    it('returns null for malformed input', () => {
      expect(parseHexColor('')).toBeNull();
      expect(parseHexColor('#12')).toBeNull();
      expect(parseHexColor('nope')).toBeNull();
      expect(parseHexColor('#12345')).toBeNull();
    });
  });

  describe('getRelativeLuminance', () => {
    it('returns 0 for black and ~1 for white', () => {
      expect(getRelativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0);
      expect(getRelativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5);
    });
  });

  describe('getReadableForeground', () => {
    it('picks dark text on light backgrounds', () => {
      expect(getReadableForeground({ r: 255, g: 255, b: 255 })).toBe('#111827');
    });

    it('picks white text on dark backgrounds', () => {
      expect(getReadableForeground({ r: 0, g: 0, b: 0 })).toBe('#ffffff');
    });
  });

  describe('rgba', () => {
    it('formats RGB channels and alpha', () => {
      expect(rgba({ r: 10, g: 20, b: 30 }, 0.14)).toBe('rgba(10, 20, 30, 0.14)');
    });
  });

  describe('normalizeHexColor', () => {
    it('lowercases valid hex', () => {
      expect(normalizeHexColor('#AABBCC')).toBe('#aabbcc');
    });

    it('throws on invalid hex', () => {
      expect(() => normalizeHexColor('red')).toThrow();
    });
  });
});
