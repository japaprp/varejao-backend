import assert from 'node:assert/strict';
import { detectImageExtension, resolveSafeImageExtension } from '../src/middlewares/uploadMiddleware.js';

assert.equal(resolveSafeImageExtension('image/jpeg'), 'jpg');
assert.equal(resolveSafeImageExtension('image/png'), 'png');
assert.equal(resolveSafeImageExtension('image/webp'), 'webp');
assert.equal(resolveSafeImageExtension('image/gif'), 'gif');
assert.equal(resolveSafeImageExtension('image/svg+xml'), null);
assert.equal(resolveSafeImageExtension('text/html'), null);
assert.equal(resolveSafeImageExtension('application/javascript'), null);
assert.equal(resolveSafeImageExtension('IMAGE/PNG'), 'png');

assert.equal(detectImageExtension(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'png');
assert.equal(detectImageExtension(Buffer.from([0xff, 0xd8, 0xff, 0x00])), 'jpg');
assert.equal(detectImageExtension(Buffer.from('RIFF0000WEBP')), 'webp');
assert.equal(detectImageExtension(Buffer.from('GIF89a')), 'gif');
assert.equal(detectImageExtension(Buffer.from('<html>')), null);
assert.equal(detectImageExtension(Buffer.from('<svg onload=alert(1)>')), null);

console.log('Upload policy tests ok');
