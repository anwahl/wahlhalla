const test = require('test');
const assert = require('assert');

test('synchronous passing test', (t) => {
    // This test passes because it does not throw an exception.
    //Testing a test, hehe.
    assert.strictEqual(1, 1);
  });
