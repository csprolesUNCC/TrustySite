// Server-side checks that don't need a database: the PNG decoder, the account rules, and the input
// validation the auth endpoints do before they touch MongoDB.
import './setup-env.js'; // first, before anything that reads process.env
import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { decodePng, decodePngDataUrl } from '../utils/png.js';
import { usernameProblem, passwordProblem, USERNAME_MAX, PASSWORD_MIN } from '../scripts/username.js';
import { RESET_TOKEN, newResetToken, hashResetToken } from '../utils/reset-token.js';
import { clientIp } from '../utils/rate-limit.js';

// A real RGBA PNG, built by hand.
function png(width, height, pixel = () => [0, 0, 0, 0]) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA, no interlace
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) raw.set(pixel(x, y), y * (width * 4 + 1) + 1 + x * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

test('decodePng() reads back the pixels it was given', () => {
  const image = decodePng(png(3, 2, (x, y) => [x * 10, y * 10, 7, 255]));
  assert.equal(image.width, 3);
  assert.equal(image.height, 2);
  assert.deepEqual([...image.data.slice(4 * 4, 4 * 5)], [10, 10, 7, 255]); // x=1, y=1
});

test('decodePngDataUrl() refuses the wrong size, non-PNGs and junk', () => {
  const url = (buf) => `data:image/png;base64,${buf.toString('base64')}`;
  assert.equal(decodePngDataUrl(url(png(500, 500)), { width: 500, height: 500 }).data.length, 500 * 500 * 4);
  assert.throws(() => decodePngDataUrl(url(png(400, 500)), { width: 500, height: 500 }));
  assert.throws(() => decodePngDataUrl(url(Buffer.from('not a png at all')), { width: 500, height: 500 }));
  assert.throws(() => decodePngDataUrl('data:image/png;base64,AAAA', { width: 500, height: 500 }));
});

test('username rules', () => {
  assert.equal(usernameProblem('trusty_fan'), null);
  assert.ok(usernameProblem(''));
  assert.ok(usernameProblem('two words'));
  assert.ok(usernameProblem('zero​width'));
  assert.ok(usernameProblem('me@example.com'));
  assert.ok(usernameProblem('x'.repeat(USERNAME_MAX + 1)));
  assert.ok(usernameProblem({ $ne: null }));
});

test('password rules', () => {
  assert.equal(passwordProblem('x'.repeat(PASSWORD_MIN)), null);
  assert.ok(passwordProblem('x'.repeat(PASSWORD_MIN - 1)));
  assert.ok(passwordProblem('x'.repeat(201)));
  assert.ok(passwordProblem({ $gt: '' }));
});

test('reset tokens: 64 hex digits, stored only as a hash', () => {
  const token = newResetToken();
  assert.match(token, RESET_TOKEN);
  assert.notEqual(newResetToken(), token);
  assert.match(hashResetToken(token), /^[0-9a-f]{64}$/);
  assert.notEqual(hashResetToken(token), token);
  assert.equal(hashResetToken(token), hashResetToken(token));
});

test('clientIp() uses the address Vercel reports', () => {
  assert.equal(clientIp({ headers: { 'x-real-ip': '1.2.3.4', 'x-forwarded-for': '5.6.7.8' } }), '1.2.3.4');
  assert.equal(clientIp({ headers: { 'x-forwarded-for': '5.6.7.8, 10.0.0.1' } }), '5.6.7.8');
  assert.equal(clientIp({ headers: {} }), 'unknown');
});

// A response object like Vercel's, enough for the handlers.
function fakeRes() {
  return {
    statusCode: 200, body: undefined, headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}

test('reset-password refuses anything but a real token before going near the database', async () => {
  // The database URL points nowhere (setup-env.js): a request that got as far as a query would fail with a 500, not a 400.
  const { default: resetPassword } = await import('../api/auth/reset-password.js');
  const tries = [
    { token: { $ne: null }, newPassword: 'longenough' }, // would match anyone with a pending reset
    { token: { $exists: true }, newPassword: 'longenough' },
    { token: ['a'.repeat(64)], newPassword: 'longenough' },
    { token: 'short', newPassword: 'longenough' },
    { token: 'a'.repeat(64), newPassword: { $gt: '' } },
    { token: 'a'.repeat(64), newPassword: 'short' },
    {},
  ];
  for (const body of tries) {
    const res = fakeRes();
    await resetPassword({ method: 'POST', body, headers: {} }, res);
    assert.equal(res.statusCode, 400, JSON.stringify(body));
  }
});

test('login refuses objects as the username or password', async () => {
  const { default: login } = await import('../api/auth/login.js');
  for (const body of [{ identifier: { $ne: null }, password: 'x' }, { identifier: 'carson', password: { $ne: null } }]) {
    const res = fakeRes();
    await login({ method: 'POST', body, headers: {} }, res);
    assert.equal(res.statusCode, 400, JSON.stringify(body));
  }
});

test('login tokens: only HS256 with the site secret counts', async () => {
  const { default: jwt } = await import('jsonwebtoken');
  const { authenticateUser } = await import('../utils/auth.js');
  const cookie = (token) => ({ headers: { cookie: `authToken=${token}` } });
  const payload = { userId: 'abc', username: 'carson' };
  assert.equal(authenticateUser(cookie(jwt.sign(payload, process.env.JWT_SECRET, { algorithm: 'HS256' }))).username, 'carson');
  assert.equal(authenticateUser(cookie(jwt.sign(payload, process.env.JWT_SECRET, { algorithm: 'HS512' }))), null);
  assert.equal(authenticateUser(cookie(jwt.sign(payload, 'someone-elses-secret'))), null);
  const unsigned = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.`;
  assert.equal(authenticateUser(cookie(unsigned)), null);
});

test('a password reset logs out the logins made before it', async () => {
  const { tokenRevoked } = await import('../utils/auth.js');
  const at = (iso) => new Date(iso);
  const iat = (iso) => Math.floor(at(iso).getTime() / 1000);
  const account = { passwordChangedAt: at('2026-11-17T12:00:00.500Z') };
  assert.equal(tokenRevoked({ iat: iat('2026-11-10T00:00:00Z') }, account), true);
  assert.equal(tokenRevoked({ iat: iat('2026-11-17T11:59:59Z') }, account), true);
  assert.equal(tokenRevoked({ iat: iat('2026-11-17T12:00:00.900Z') }, account), false, 'logged in again in the same second');
  assert.equal(tokenRevoked({ iat: iat('2026-11-18T00:00:00Z') }, account), false);
  assert.equal(tokenRevoked({}, account), true, 'a token that doesn’t say when it was made');
  assert.equal(tokenRevoked({ iat: 1 }, {}), false, 'never reset');
  assert.equal(tokenRevoked({ iat: 1 }, null), false, 'no account to go by');
});

test('public boards: the CDN keeps them briefly, and ?fresh=1 skips it', async () => {
  const { cachePublic } = await import('../utils/cache.js');
  const cached = fakeRes();
  cachePublic({ query: {} }, cached);
  assert.match(cached.headers['Vercel-CDN-Cache-Control'], /^max-age=\d+$/);
  assert.equal(cached.headers['Cache-Control'], 'no-cache');
  const fresh = fakeRes();
  cachePublic({ query: { fresh: '1' } }, fresh);
  assert.equal(fresh.headers['Cache-Control'], 'no-store');
  assert.equal(fresh.headers['Vercel-CDN-Cache-Control'], undefined);
});
