import type { Redis } from 'ioredis';
import type { CounterStore } from './counterLoginThrottle.js';

/** Keys live under `<prefix>:`, inside the service's Redis ACL prefix. */
export class RedisCounterStore implements CounterStore {
  constructor(
    private readonly redis: Redis,
    private readonly prefix: string,
  ) {}

  async increment(key: string, ttlMs: number): Promise<number> {
    const value = await this.redis.incrby(this.keyOf(key), 1);
    if (value === 1) await this.redis.pexpire(this.keyOf(key), ttlMs);
    return value;
  }

  async read(key: string): Promise<number> {
    return Number((await this.redis.get(this.keyOf(key))) ?? 0);
  }

  async remainingMs(key: string): Promise<number> {
    return Math.max(0, await this.redis.pttl(this.keyOf(key)));
  }

  async setFor(key: string, ttlMs: number): Promise<void> {
    await this.redis.set(this.keyOf(key), '1', 'PX', ttlMs);
  }

  async remove(key: string): Promise<void> {
    await this.redis.del(this.keyOf(key));
  }

  private keyOf(key: string): string {
    return `${this.prefix}:${key}`;
  }
}
