import test from 'node:test';
import assert from 'node:assert/strict';

function sanitizeNodeToFile(node) {
  return (
    node
      .replace(/A&M/gi, 'and_m')
      .replace(/&/g, 'and')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase() +
    '.avif'
  );
}

test('handles Texas A&M', () => {
  assert.equal(sanitizeNodeToFile('Texas A&M'), 'texas_and_m.avif');
});

test('handles ampersand general case', () => {
  assert.equal(sanitizeNodeToFile('Bears & Bulls'), 'bears_and_bulls.avif');
});

test('handles other special characters', () => {
  assert.equal(sanitizeNodeToFile('Hello @World!'), 'hello_world.avif');
  assert.equal(sanitizeNodeToFile('New York Jets'), 'new_york_jets.avif');
});
