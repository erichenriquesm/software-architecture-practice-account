import type { CounterStore } from '../../src/infra/security/counterLoginThrottle.js';

/** Same contract as the Redis store, on a clock the test moves. */
export class MemoryCounterStore implements CounterStore {
  private readonly entries = new Map<string, { value: number; expiresAt: number }>();
  nowMs = 0;

  async increment(key: string, ttlMs: number): Promise<number> {
    const entry = this.live(key);
    const next = { value: (entry?.value ?? 0) + 1, expiresAt: entry?.expiresAt ?? this.nowMs + ttlMs };
    this.entries.set(key, next);
    return next.value;
  }

  async read(key: string): Promise<number> {
    return this.live(key)?.value ?? 0;
  }

  async remainingMs(key: string): Promise<number> {
    const entry = this.live(key);
    return entry ? entry.expiresAt - this.nowMs : 0;
  }

  async setFor(key: string, ttlMs: number): Promise<void> {
    this.entries.set(key, { value: 1, expiresAt: this.nowMs + ttlMs });
  }

  async remove(key: string): Promise<void> {
    this.entries.delete(key);
  }

  private live(key: string) {
    const entry = this.entries.get(key);
    if (entry && entry.expiresAt > this.nowMs) return entry;
    this.entries.delete(key);
    return undefined;
  }
}
