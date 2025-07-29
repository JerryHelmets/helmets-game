import { describe, expect, it } from 'vitest';
import { sanitizeNodeToFile } from './GameComponent';

// these tests verify sanitizeNodeToFile handles spaces, punctuation and ampersands

describe('sanitizeNodeToFile', () => {
  it('converts simple names', () => {
    expect(sanitizeNodeToFile('Tom Brady')).toBe('tom_brady.avif');
  });

  it('handles punctuation and trimming', () => {
    expect(sanitizeNodeToFile('  Hello, World! ')).toBe('hello_world.avif');
  });

  it('preserves numbers', () => {
    expect(sanitizeNodeToFile('Player123')).toBe('player123.avif');
  });

  it('replaces ampersands with "and"', () => {
    expect(sanitizeNodeToFile('A&B Co.')).toBe('aandb_co.avif');
  });

  it('collapses multiple separators', () => {
    expect(sanitizeNodeToFile('cool--player')).toBe('cool_player.avif');
  });
});
