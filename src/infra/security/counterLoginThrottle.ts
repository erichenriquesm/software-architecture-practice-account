import type { LoginThrottle } from '../../application/contracts/loginThrottle.js';

/** Expiring counters; Redis in the service, memory in tests. */
export interface CounterStore {
  /** Adds one; the first increment starts the key's time to live. */
  increment(key: string, ttlMs: number): Promise<number>;
  read(key: string): Promise<number>;
  remainingMs(key: string): Promise<number>;
  setFor(key: string, ttlMs: number): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface LoginThrottlePolicy {
  readonly failuresPerEmail: number;
  readonly failureWindowMs: number;
  readonly firstLockMs: number;
  readonly maxLockMs: number;
  readonly lockMemoryMs: number;
  readonly failuresPerIp: number;
  readonly ipWindowMs: number;
}

const minute = 60_000;
const hour = 60 * minute;

/** OWASP: 5 failures in 15 min lock the email for 5 min, doubling up to 24 h; 20 failures per IP per hour. */
export const owaspLoginThrottlePolicy: LoginThrottlePolicy = {
  failuresPerEmail: 5,
  failureWindowMs: 15 * minute,
  firstLockMs: 5 * minute,
  maxLockMs: 24 * hour,
  lockMemoryMs: 24 * hour,
  failuresPerIp: 20,
  ipWindowMs: hour,
};

const seconds = (ms: number): number => Math.max(1, Math.ceil(ms / 1_000));

/** Fails open: when the store is down a login goes through unthrottled and onStoreError is called. */
export class CounterLoginThrottle implements LoginThrottle {
  constructor(
    private readonly store: CounterStore,
    private readonly onStoreError: (error: unknown) => void,
    private readonly policy: LoginThrottlePolicy = owaspLoginThrottlePolicy,
  ) {}

  blockedFor(email: string, ip: string): Promise<number | undefined> {
    return this.failOpen(async () => {
      const emailLockMs = await this.store.remainingMs(`lock:${email}`);
      if (emailLockMs > 0) return seconds(emailLockMs);
      if ((await this.store.read(`ip:${ip}`)) < this.policy.failuresPerIp) return undefined;
      return seconds(await this.store.remainingMs(`ip:${ip}`));
    });
  }

  async recordFailure(email: string, ip: string): Promise<void> {
    await this.failOpen(async () => {
      await this.store.increment(`ip:${ip}`, this.policy.ipWindowMs);
      const failures = await this.store.increment(`failures:${email}`, this.policy.failureWindowMs);
      if (failures < this.policy.failuresPerEmail) return;
      await this.lock(email);
    });
  }

  async reset(email: string): Promise<void> {
    await this.failOpen(() => this.store.remove(`failures:${email}`));
  }

  private async lock(email: string): Promise<void> {
    const locks = await this.store.increment(`locks:${email}`, this.policy.lockMemoryMs);
    const lockMs = Math.min(this.policy.firstLockMs * 2 ** (locks - 1), this.policy.maxLockMs);
    await this.store.setFor(`lock:${email}`, lockMs);
    await this.store.remove(`failures:${email}`);
  }

  private async failOpen<T>(work: () => Promise<T>): Promise<T | undefined> {
    try {
      return await work();
    } catch (error) {
      this.onStoreError(error);
      return undefined;
    }
  }
}
