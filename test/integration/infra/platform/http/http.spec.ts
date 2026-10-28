import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { RateLimitCheck } from '../../../../../src/infra/platform/http/rateLimit/rateLimiter.js';
import { RedisRateLimiter } from '../../../../../src/infra/platform/http/rateLimit/rateLimiter.js';
import { registerRateLimit } from '../../../../../src/infra/platform/http/rateLimit/rateLimitPlugin.js';

const redisUrl = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379';
let redis: Redis;

beforeAll(async () => {
  redis = new Redis(redisUrl, { enableOfflineQueue: false, maxRetriesPerRequest: 1, lazyConnect: true });
  await redis.connect();
});

afterAll(() => {
  redis.disconnect();
});

const checkAt = (nowMs: number, subject: string): RateLimitCheck => ({
  subject,
  policy: { name: 'orders', limit: 5, windowMs: 10_000 },
  cost: 1,
  nowMs,
});

describe('RedisRateLimiter', () => {
  test('Should apply the sliding window: 5 per window, the previous window weighted by the time left', async () => {
    // Given
    const limiter = new RedisRateLimiter(redis, `svc${randomUUID().slice(0, 8)}`);
    const moments = [0, 1_000, 2_000, 3_000, 4_000, 5_000, 9_999, 10_500, 14_000, 15_000, 19_000, 25_000];

    // When
    const decisions = [];
    for (const moment of moments) decisions.push((await limiter.check(checkAt(moment, 'account:a-1'))).allowed);

    // Then
    expect(decisions).toEqual([true, true, true, true, true, false, false, false, true, true, true, true]);
  });

  test('Should fail open: with Redis unreachable the plugin lets every request through', async () => {
    // Given
    const unreachable = new Redis('redis://127.0.0.1:1', {
      enableOfflineQueue: false,
      lazyConnect: true,
      retryStrategy: () => null,
    }).on('error', () => undefined);
    const app = Fastify({ logger: false });
    registerRateLimit(app, {
      limiter: new RedisRateLimiter(unreachable, 'svc'),
      groups: [{ name: 'orders', matches: () => true, perIp: { limit: 1, windowMs: 60_000 } }],
    });
    app.get('/limited', async () => ({ ok: true }));

    // When
    const responses = [];
    for (let index = 0; index < 3; index += 1) responses.push(await app.inject({ method: 'GET', url: '/limited' }));

    // Then
    expect(responses.map((response) => response.statusCode)).toEqual([200, 200, 200]);
    unreachable.disconnect();
    await app.close();
  });
});
