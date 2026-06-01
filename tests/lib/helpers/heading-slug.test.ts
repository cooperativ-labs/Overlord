import { createHeadingSlugRegistry, slugifyHeadingText } from '@/lib/helpers/heading-slug';

describe('slugifyHeadingText', () => {
  it('slugifies heading text', () => {
    expect(slugifyHeadingText('Hello World')).toBe('hello-world');
    expect(slugifyHeadingText('Step 1 — Install')).toBe('step-1-install');
  });

  it('falls back when slug would be empty', () => {
    expect(slugifyHeadingText('!!!')).toBe('section');
  });
});

describe('createHeadingSlugRegistry', () => {
  it('deduplicates repeated headings', () => {
    const register = createHeadingSlugRegistry();
    expect(register('Overview')).toBe('overview');
    expect(register('Overview')).toBe('overview-1');
    expect(register('Overview')).toBe('overview-2');
  });
});
