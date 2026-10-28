import { describe, expect, test } from 'vitest';
import { CounterLoginThrottle } from '../../../../src/infra/security/counterLoginThrottle.js';
import type { CounterStore } from '../../../../src/infra/security/counterLoginThrottle.js';
import { MemoryCounterStore } from '../../../fakes/memoryCounterStore.js';

const minute = 60_000;
const fail = async (throttle: CounterLoginThrottle, times: number, email = 'ana@example.com', ip = '10.0.0.1') => {
  for (let attempt = 0; attempt < times; attempt += 1) await throttle.recordFailure(email, ip);
};

describe('Login throttle', () => {
  test('Should lock the email for 5 min after 5 failures and double the lock on each repeat', async () => {
    // Given
    const store = new MemoryCounterStore();
    const throttle = new CounterLoginThrottle(store, () => undefined);

    // When & Then
    await fail(throttle, 4);
    expect(await throttle.blockedFor('ana@example.com', '10.0.0.2')).toBeUndefined();
    await fail(throttle, 1);
    expect(await throttle.blockedFor('ana@example.com', '10.0.0.2')).toBe(300);
    store.nowMs += 5 * minute;
    expect(await throttle.blockedFor('ana@example.com', '10.0.0.2')).toBeUndefined();
    await fail(throttle, 5, 'ana@example.com', '10.0.0.3');
    expect(await throttle.blockedFor('ana@example.com', '10.0.0.2')).toBe(600);
  });

  test('Should lock an email that has no account, so a lock never reveals which emails exist', async () => {
    const throttle = new CounterLoginThrottle(new MemoryCounterStore(), () => undefined);

    await fail(throttle, 5, 'nobody@example.com');

    expect(await throttle.blockedFor('nobody@example.com', '10.0.0.9')).toBe(300);
  });

  test('Should block an IP after 20 failures spread over many emails (password spraying)', async () => {
    // Given
    const throttle = new CounterLoginThrottle(new MemoryCounterStore(), () => undefined);

    // When
    for (let index = 0; index < 20; index += 1) await throttle.recordFailure(`user${index}@example.com`, '10.0.0.1');

    // Then
    expect(await throttle.blockedFor('fresh@example.com', '10.0.0.1')).toBe(3_600);
    expect(await throttle.blockedFor('fresh@example.com', '10.0.0.2')).toBeUndefined();
  });

  test('Should forget the failures after a successful login', async () => {
    const throttle = new CounterLoginThrottle(new MemoryCounterStore(), () => undefined);

    await fail(throttle, 4);
    await throttle.reset('ana@example.com');
    await fail(throttle, 1);

    expect(await throttle.blockedFor('ana@example.com', '10.0.0.2')).toBeUndefined();
  });

  test('Should fail open and report when the store is down', async () => {
    // Given
    const broken = new Error('redis down');
    const failing: CounterStore = {
      increment: () => Promise.reject(broken),
      read: () => Promise.reject(broken),
      remainingMs: () => Promise.reject(broken),
      setFor: () => Promise.reject(broken),
      remove: () => Promise.reject(broken),
    };
    const reported: unknown[] = [];
    const throttle = new CounterLoginThrottle(failing, (error) => reported.push(error));

    // When
    const blocked = await throttle.blockedFor('ana@example.com', '10.0.0.1');
    await throttle.recordFailure('ana@example.com', '10.0.0.1');

    // Then
    expect(blocked).toBeUndefined();
    expect(reported).toEqual([broken, broken]);
  });
});
