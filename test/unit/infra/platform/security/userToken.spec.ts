import { generateKeyPairSync } from 'node:crypto';
import Fastify from 'fastify';
import { describe, expect, test } from 'vitest';
import {
  InvalidUserTokenError,
  registerUserTokenGuard,
  signUserToken,
  userAccountIdOf,
  userTokenPublicKey,
  verifyUserToken,
} from '../../../../../src/infra/platform/security/userToken.js';
import type { UserTokenClaims } from '../../../../../src/infra/platform/security/userToken.js';

const keys = generateKeyPairSync('ed25519');
const now = 1_793_000_000;
const claims: UserTokenClaims = { iss: 'account', sub: '0199d5f4-2b9a-7c3e-9a51-2f1d3c4b5a69', aud: 'account', iat: now, exp: now + 60, jti: 'j-1' };
const token = (overrides: Partial<UserTokenClaims> = {}, privateKey = keys.privateKey) => signUserToken({ ...claims, ...overrides }, privateKey);
const segment = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

describe('User token', () => {
  test('Should verify a token it signed and give back the claims', () => {
    expect(verifyUserToken(token(), keys.publicKey, 'account', now)).toEqual(claims);
  });

  test('Should accept 5 s of clock skew after exp and no more', () => {
    expect(() => verifyUserToken(token(), keys.publicKey, 'account', now + 65)).not.toThrow();
    expect(() => verifyUserToken(token(), keys.publicKey, 'account', now + 66)).toThrowError(/expired/);
  });

  test.each([
    ['another audience', token({ aud: 'wallet' }), /audience/],
    ['another issuer', token({ iss: 'edge' }), /issuer/],
    ['another key', token({}, generateKeyPairSync('ed25519').privateKey), /signature/],
    ['alg none', `${segment({ alg: 'none', typ: 'JWT' })}.${segment(claims)}.c2ln`, /alg/],
    ['claims changed after signing', `${token().split('.')[0]}.${segment({ ...claims, sub: 'someone-else' })}.${token().split('.')[2]}`, /signature/],
    ['two segments', 'a.b', /malformed/],
    ['garbage', 'not.a.token', /malformed/],
    ['a missing claim', signUserToken({ ...claims, jti: undefined } as unknown as UserTokenClaims, keys.privateKey), /claims/],
  ])('Should refuse %s', (_case, candidate, reason) => {
    expect(() => verifyUserToken(candidate, keys.publicKey, 'account', now)).toThrowError(reason);
  });

  test('Should read a public key written on one line with literal \\n', () => {
    const onOneLine = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString().replaceAll('\n', '\\n');

    expect(verifyUserToken(token(), userTokenPublicKey(onOneLine), 'account', now).sub).toBe(claims.sub);
  });
});

describe('User token guard', () => {
  const buildApp = () => {
    const app = Fastify({ logger: false });
    registerUserTokenGuard(app, { publicKey: keys.publicKey, audience: 'account', publicRoutes: new Set(['/open']), nowSeconds: () => now });
    app.get('/private', async (request) => ({ accountId: userAccountIdOf(request) }));
    app.get('/open', async () => ({ open: true }));
    return app;
  };

  test('Should hand the token subject to the handler', async () => {
    const response = await buildApp().inject({ method: 'GET', url: '/private', headers: { authorization: `Bearer ${token()}` } });

    expect(response.json()).toEqual({ accountId: claims.sub });
  });

  test.each([
    ['no header', {}],
    ['another scheme', { authorization: `Basic ${token()}` }],
    ['an invalid token', { authorization: `Bearer ${token({ aud: 'order' })}` }],
  ])('Should answer 401 for %s and leave public routes alone', async (_case, headers) => {
    const app = buildApp();

    const refused = await app.inject({ method: 'GET', url: '/private', headers });
    const open = await app.inject({ method: 'GET', url: '/open' });

    expect(refused.statusCode).toBe(401);
    expect(refused.json()).toMatchObject({ error: 'unauthenticated' });
    expect(open.statusCode).toBe(200);
  });

  test('Should refuse to read the user of a route the guard does not cover', () => {
    expect(() => userAccountIdOf({} as never)).toThrowError(InvalidUserTokenError);
  });
});
