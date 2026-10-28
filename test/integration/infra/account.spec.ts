import { createHash, randomUUID } from 'node:crypto';
import grpc from '@grpc/grpc-js';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { TestDatabase } from '../../support/database.js';
import { createTestDatabase } from '../../support/database.js';
import type { PasswordHasher } from '../../../src/application/contracts/passwordHasher.js';
import type { Password } from '../../../src/domain/valueObjects/password.js';
import { PasswordHash } from '../../../src/domain/valueObjects/passwordHash.js';
import { startAccountGrpcServer } from '../../../src/infra/grpc/accountGrpcServer.js';
import { walletBalancesHandler } from '../../../src/infra/messaging/walletBalancesConsumer.js';
import { AccountServiceClient } from '../../../src/infra/generated/account.js';
import { buildAccountApi, buildAccountCore } from '../../../src/infra/composition.js';
import type { RateLimiter } from '../../../src/infra/platform/http/rateLimit/rateLimiter.js';
import { RedisRateLimiter } from '../../../src/infra/platform/http/rateLimit/rateLimiter.js';
import { createEnvelope, loadEnvelopeValidator } from '../../../src/infra/platform/messaging/envelope.js';
import { loadSchemaValidator } from '../../../src/infra/platform/messaging/schemas.js';
import { serviceTokenHeader } from '../../../src/infra/platform/security/serviceAuth.js';
import { verifyUserToken } from '../../../src/infra/platform/security/userToken.js';
import { CounterLoginThrottle } from '../../../src/infra/security/counterLoginThrottle.js';
import { MemoryCounterStore } from '../../fakes/memoryCounterStore.js';
import { bearer, nowSeconds, testUserTokenKeys } from '../../support/userTokens.js';

const fastHasher: PasswordHasher = {
  hash: async (password: Password) => PasswordHash.from(`$argon2id$test$${password.value}`),
  verify: async (password: string, hash: PasswordHash | undefined) => hash?.value === `$argon2id$test$${password}`,
};
const unlimited: RateLimiter = {
  check: async (check) => ({ allowed: true, remaining: check.policy.limit, resetSeconds: 0, retryAfterSeconds: 0, policy: check.policy }),
};

let database: TestDatabase;
let app: FastifyInstance;

const authDependencies = () => ({
  loginThrottle: new CounterLoginThrottle(new MemoryCounterStore(), () => undefined),
  userTokenKeys: testUserTokenKeys,
});

const signupBody = (email: string) => ({ name: 'Ana Souza', email, document: '529.982.247-25', password: 'Abcdefg1' });
const signup = (email: string) => app.inject({ method: 'POST', url: '/signup', payload: signupBody(email) });

beforeAll(async () => {
  database = await createTestDatabase();
  app = buildAccountApi({ db: database.db, rateLimiter: unlimited, passwordHasher: fastHasher, ...authDependencies() });
});

afterAll(async () => {
  await app.close();
  await database.destroy();
});

describe('Signup', () => {
  test('Should create the account and write a valid account.created envelope to the outbox in the same transaction', async () => {
    // When
    const response = await signup('first@example.com');

    // Then
    expect(response.statusCode).toBe(201);
    const { accountId } = response.json();
    const outbox = await database.db.selectFrom('outbox').select(['routing_key', 'envelope']).execute();
    const row = outbox.find((candidate) => (candidate.envelope as { payload: { accountId: string } }).payload.accountId === accountId);
    expect(row?.routing_key).toBe('account.created');
    const envelope = loadEnvelopeValidator()(row?.envelope);
    expect(loadSchemaValidator('src/infra/schemas/published/events/account.created.v1.schema.json')(envelope.payload)).toEqual({ accountId });
    expect(envelope.correlationId).toBe(response.headers['x-correlation-id']);
  });

  test('Should let only one of two concurrent signups with the same email succeed', async () => {
    // When
    const responses = await Promise.all([signup('race@example.com'), signup('RACE@example.com')]);

    // Then
    expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 409]);
  });
});

describe('Signup rate limit', () => {
  test('Should allow 3 attempts per email and 5 per IP per hour, then answer 429 with Retry-After', async () => {
    // Given
    const redis = new Redis(process.env.TEST_REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 1 });
    const rateLimiter = new RedisRateLimiter(redis, `account${randomUUID().slice(0, 8)}`);
    const limitedApp = buildAccountApi({ db: database.db, rateLimiter, passwordHasher: fastHasher, ...authDependencies() });
    const attempt = (email: string) => limitedApp.inject({ method: 'POST', url: '/signup', payload: signupBody(email) });

    // When
    const sameEmail = [await attempt('limit@example.com'), await attempt('limit@example.com'), await attempt('limit@example.com'), await attempt('limit@example.com')];
    const otherEmails = [await attempt('limit2@example.com'), await attempt('limit3@example.com')];

    // Then
    expect(sameEmail.map((response) => response.statusCode)).toEqual([201, 409, 409, 429]);
    expect(Number(sameEmail[3]?.headers['retry-after'])).toBeGreaterThan(0);
    expect(otherEmails.map((response) => response.statusCode)).toEqual([201, 429]);
    await limitedApp.close();
    redis.disconnect();
  });
});

describe('GetAccount balances', () => {
  const projectBalance = async (accountId: string, available: string, version: number) =>
    buildAccountCore(database.db).projectWalletBalance.execute({ accountId, assetId: 'USD', available, reserved: '0', version });

  test('Should answer from the projection and keep the newest version when an older one arrives late', async () => {
    // Given
    const { accountId } = (await signup('projected@example.com')).json();
    await projectBalance(accountId, '200', 2);
    await projectBalance(accountId, '100', 1);

    // When
    const response = await app.inject({ method: 'GET', url: `/accounts/${accountId}`, headers: bearer(accountId) });

    // Then
    expect(response.json()).toEqual({
      accountId,
      name: 'Ana Souza',
      email: 'projected@example.com',
      document: '52998224725',
      assets: [{ assetId: 'USD', quantity: '200.00000000', available: '200.00000000', reserved: '0.00000000' }],
    });
  });

  test('Should answer an empty asset list for a new account with nothing projected yet', async () => {
    // Given
    const { accountId } = (await signup('fresh@example.com')).json();

    // When
    const response = await app.inject({ method: 'GET', url: `/accounts/${accountId}`, headers: bearer(accountId) });

    // Then
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ accountId, assets: [] });
    expect(response.json()).not.toHaveProperty('balancesStatus');
  });
});

describe('wallet.balanceChanged consumer handler', () => {
  test('Should project a valid event and reject a payload outside the contract', async () => {
    // Given
    const { accountId } = (await signup('consumer@example.com')).json();
    const core = buildAccountCore(database.db);
    const handler = walletBalancesHandler(core.projectWalletBalance);
    const envelopeWith = (payload: Record<string, unknown>) =>
      createEnvelope({ type: 'wallet.balanceChanged', version: 1, producer: 'wallet', correlationId: '0199d5f4-2b9a-7c3e-9a51-2f1d3c4b5a69', payload });

    // When
    await core.runner.run(() => handler(envelopeWith({ accountId, assetId: 'USD', available: '7.5', reserved: '2.5', version: 1 }), core.runner.transaction()));

    // Then
    const balances = await core.balanceDao.listByAccount(accountId);
    expect(balances).toEqual([{ assetId: 'USD', available: '7.50000000', reserved: '2.50000000' }]);
    await expect(core.runner.run(() => handler(envelopeWith({ accountId, assetId: 'USD' }), core.runner.transaction()))).rejects.toThrowError(
      /wallet\.balanceChanged/,
    );
  });
});

describe('AccountService.Exists with the shared token', () => {
  test('Should answer a caller with the token and refuse a wrong or missing token with UNAUTHENTICATED', async () => {
    // Given
    const { accountId } = (await signup('grpc@example.com')).json();
    const denied: string[] = [];
    const { server, port } = await startAccountGrpcServer({
      accountExists: buildAccountCore(database.db).accountExists,
      token: 'internal-grpc-test',
      address: '127.0.0.1:0',
      onDenied: (method) => denied.push(method),
    });
    const client = new AccountServiceClient(`127.0.0.1:${port}`, grpc.credentials.createInsecure());
    const existsWith = (token: string | undefined, id: string) => {
      const metadata = new grpc.Metadata();
      if (token !== undefined) metadata.set(serviceTokenHeader, token);
      return new Promise<boolean>((resolve, reject) =>
        client.exists({ accountId: id }, metadata, (error, response) => (error ? reject(error) : resolve(response.exists))),
      );
    };

    // When & Then
    await expect(existsWith('internal-grpc-test', accountId)).resolves.toBe(true);
    await expect(existsWith('internal-grpc-test', '0199d5f4-2b9a-7c3e-9a51-2f1d3c4b5a69')).resolves.toBe(false);
    await expect(existsWith('wrong-token', accountId)).rejects.toMatchObject({ code: grpc.status.UNAUTHENTICATED });
    await expect(existsWith(undefined, accountId)).rejects.toMatchObject({ code: grpc.status.UNAUTHENTICATED });
    expect(denied).toEqual(['/trading.account.v1.AccountService/Exists', '/trading.account.v1.AccountService/Exists']);
    client.close();
    server.forceShutdown();
  });
});

describe('Login, session and the internal user token', () => {
  const login = (email: string, password: string) => app.inject({ method: 'POST', url: '/login', payload: { email, password } });
  const sessionOf = (response: { headers: Record<string, unknown> }) => String(response.headers['set-cookie']).split(';')[0] ?? '';
  const internalSession = (cookie: string | undefined, audience = 'wallet') =>
    app.inject({ method: 'GET', url: '/internal/session', headers: { ...(cookie ? { cookie } : {}), 'x-audience': audience } });

  test('Should start a session in an HttpOnly, Secure, SameSite=Strict cookie and keep only its hash', async () => {
    // Given
    const { accountId } = (await signup('login@example.com')).json();

    // When
    const response = await login('LOGIN@example.com ', 'Abcdefg1');

    // Then
    expect(response.statusCode).toBe(204);
    const setCookie = String(response.headers['set-cookie']);
    expect(setCookie).toMatch(/^session=[A-Za-z0-9_-]{43}; HttpOnly; Secure; SameSite=Strict; Path=\/; Max-Age=43200$/);
    const token = sessionOf(response).slice('session='.length);
    const rows = await database.db.selectFrom('session').select(['account_id', 'token_hash']).where('account_id', '=', accountId).execute();
    expect(rows).toEqual([{ account_id: accountId, token_hash: createHash('sha256').update(token).digest('hex') }]);
  });

  test('Should answer a wrong password and an unknown email with the same 401', async () => {
    // Given
    await signup('wrong@example.com');

    // When
    const wrongPassword = await login('wrong@example.com', 'Abcdefg2');
    const unknownEmail = await login('nobody@example.com', 'Abcdefg1');

    // Then
    expect([wrongPassword.statusCode, unknownEmail.statusCode]).toEqual([401, 401]);
    expect(wrongPassword.json()).toEqual(unknownEmail.json());
    expect(wrongPassword.json()).toMatchObject({ error: 'invalidCredentials' });
    expect(wrongPassword.headers['set-cookie']).toBeUndefined();
  });

  test('Should lock the email after 5 failures and answer 429 with Retry-After, even with the right password', async () => {
    // Given
    await signup('locked@example.com');
    for (let attempt = 0; attempt < 5; attempt += 1) await login('locked@example.com', 'Wrongpass1');

    // When
    const response = await login('locked@example.com', 'Abcdefg1');

    // Then
    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({ error: 'tooManyLoginAttempts' });
    expect(Number(response.headers['retry-after'])).toBe(300);
  });

  test('Should trade a live session for a 60 s user token for the asked audience', async () => {
    // Given
    const { accountId } = (await signup('token@example.com')).json();
    const cookie = sessionOf(await login('token@example.com', 'Abcdefg1'));

    // When
    const response = await internalSession(cookie, 'wallet');

    // Then
    expect(response.statusCode).toBe(204);
    const claims = verifyUserToken(String(response.headers['x-user-token']), testUserTokenKeys.publicKey, 'wallet', nowSeconds());
    expect(claims).toMatchObject({ iss: 'account', sub: accountId, aud: 'wallet' });
    expect(claims.exp - claims.iat).toBe(60);
  });

  test('Should refuse the internal token without a session, after logout, and for an unknown audience', async () => {
    // Given
    await signup('logout@example.com');
    const cookie = sessionOf(await login('logout@example.com', 'Abcdefg1'));

    // When
    const unknownAudience = await internalSession(cookie, 'matching');
    const logout = await app.inject({ method: 'POST', url: '/logout', headers: { cookie } });
    const afterLogout = await internalSession(cookie);
    const noCookie = await internalSession(undefined);

    // Then
    expect(unknownAudience.statusCode).toBe(400);
    expect(logout.statusCode).toBe(204);
    expect(String(logout.headers['set-cookie'])).toContain('Max-Age=0');
    expect([afterLogout.statusCode, noCookie.statusCode]).toEqual([401, 401]);
    expect(afterLogout.json()).toMatchObject({ error: 'unauthenticated' });
  });

  test('Should answer /me only with a user token and refuse another account on /accounts/:accountId', async () => {
    // Given
    const { accountId } = (await signup('me@example.com')).json();
    const other = (await signup('other@example.com')).json().accountId as string;

    // When
    const me = await app.inject({ method: 'GET', url: '/me', headers: bearer(accountId) });
    const anonymous = await app.inject({ method: 'GET', url: '/me' });
    const wrongAudience = await app.inject({ method: 'GET', url: '/me', headers: bearer(accountId, { aud: 'wallet' }) });
    const foreign = await app.inject({ method: 'GET', url: `/accounts/${other}`, headers: bearer(accountId) });

    // Then
    expect(me.json()).toEqual({ accountId, name: 'Ana Souza', email: 'me@example.com' });
    expect([anonymous.statusCode, wrongAudience.statusCode]).toEqual([401, 401]);
    expect(foreign.statusCode).toBe(403);
  });

  test('Should reject a login body with fields outside the contract', async () => {
    const response = await app.inject({ method: 'POST', url: '/login', payload: { email: 'a@example.com', password: 'Abcdefg1', accountId: 'x' } });

    expect(response.statusCode).toBe(422);
  });
});
