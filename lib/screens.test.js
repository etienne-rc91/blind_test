const test = require('node:test');
const assert = require('node:assert/strict');
const { isLoopback, createScreenRegistry } = require('./screens');

test('isLoopback recognises the three loopback forms only', () => {
  for (const a of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) assert.equal(isLoopback(a), true);
  for (const a of ['192.168.1.20', '::ffff:192.168.1.20', undefined]) assert.equal(isLoopback(a), false);
});

test('the last loopback screen reads', () => {
  const reg = createScreenRegistry();
  assert.equal(reg.reader(), null);
  reg.add('a', { loopback: true });
  reg.add('b', { loopback: true });
  assert.equal(reg.reader(), 'b');
  reg.remove('b');
  assert.equal(reg.reader(), 'a');
  reg.add('c', { loopback: false });
  assert.equal(reg.reader(), 'a');
  reg.remove('a');
  assert.equal(reg.reader(), null);
});
