import assert from 'node:assert/strict';
import { resolveSafeImageExtension } from '../src/middlewares/uploadMiddleware.js';

assert.equal(resolveSafeImageExtension('image/jpeg'), 'jpg');
assert.equal(resolveSafeImageExtension('image/png'), 'png');
assert.equal(resolveSafeImageExtension('image/webp'), 'webp');
assert.equal(resolveSafeImageExtension('image/gif'), 'gif');
assert.equal(resolveSafeImageExtension('image/svg+xml'), null);
assert.equal(resolveSafeImageExtension('text/html'), null);
assert.equal(resolveSafeImageExtension('application/javascript'), null);
assert.equal(resolveSafeImageExtension('IMAGE/PNG'), 'png');

console.log('Upload policy tests ok');
