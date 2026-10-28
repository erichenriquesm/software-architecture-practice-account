import { randomUUID } from 'node:crypto';
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

const fastHasher: PasswordHasher = { hash: async (password: Password) => PasswordHash.from(`$argon2id$test$${password.value.length}`) };
const unlimited: RateLimiter = {
  check: async (check) => ({ allowed: true, remaining: check.policy.limit, resetSeconds: 0, retryAfterSeconds: 0, policy: check.policy }),
};

let database: TestDatabase;
let app: FastifyInstance;

const signupBody = (email: string) => ({ name: 'Ana Souza', email, document: '529.982.247-25', password: 'Abcdefg1' });
const signup = (email: string) => app.inject({ method: 'POST', url: '/signup', payload: signupBody(email) });

beforeAll(async () => {
  database = await createTestDatabase();
  app = buildAccountApi({ db: database.db, rateLimiter: unlimited, passwordHasher: fastHasher });
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
    const limitedApp = buildAccountApi({ db: database.db, rateLimiter, passwordHasher: fastHasher });
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
    const response = await app.inject({ method: 'GET', url: `/accounts/${accountId}` });

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
    const response = await app.inject({ method: 'GET', url: `/accounts/${accountId}` });

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
