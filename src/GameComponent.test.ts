import { describe, it, expect } from 'vitest';
import { sanitizeNodeToFile } from './GameComponent';

describe('sanitizeNodeToFile', () => {
  it('handles normal names', () => {
    expect(sanitizeNodeToFile('New York Jets')).toBe('new_york_jets.avif');
  });

  it('trims special characters', () => {
    expect(sanitizeNodeToFile('  Hello!? ')).toBe('hello.avif');
  });

  it('replaces ampersand with and surrounded by underscores', () => {
    expect(sanitizeNodeToFile('R & B')).toBe('r_and_b.avif');
  });

  it('handles "A&M" abbreviation', () => {
    expect(sanitizeNodeToFile('Texas A&M')).toBe('texas_and_m.avif');
  });
});
