import test from 'node:test';
import assert from 'node:assert/strict';
import { authorized, isLoopback } from '../src/auth.js';

const basic = (user, pass) => 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');

test('no password configured means no check; wrong or missing credentials are rejected', () => {
  assert.equal(authorized(undefined, ''), true);
  assert.equal(authorized(undefined, 'secret'), false);
  assert.equal(authorized('Bearer abc', 'secret'), false);
  assert.equal(authorized(basic('pod', 'wrong'), 'secret'), false);
  assert.equal(authorized(basic('pod', ''), 'secret'), false);
  assert.equal(authorized('Basic !!!notbase64', 'secret'), false);
});

test('correct password is accepted with any user name, including passwords containing colons', () => {
  assert.equal(authorized(basic('anyone', 'secret'), 'secret'), true);
  assert.equal(authorized(basic('', 'secret'), 'secret'), true);
  assert.equal(authorized(basic('u', 'pa:ss:word'), 'pa:ss:word'), true);
  assert.equal(authorized(basic('u', 'pa:ss'), 'pa:ss:word'), false);
});

test('loopback detection', () => {
  assert.equal(isLoopback('127.0.0.1'), true);
  assert.equal(isLoopback('0.0.0.0'), false);
});
