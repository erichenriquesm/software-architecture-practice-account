import type { KeyObject } from 'node:crypto';
import type { PostgresSettings } from './database/postgres.js';
import { MissingConfigurationError, numberEnv, requiredEnv } from './platform/config/env.js';
import type { RateLimitPolicy } from './platform/http/rateLimit/slidingWindow.js';
import { userTokenPrivateKey, userTokenPublicKey } from './platform/security/userToken.js';

export const apiPortSetting = (): number => numberEnv('API_PORT', 3000);

export const grpcPortSetting = (): number => numberEnv('GRPC_PORT', 50051);

export const healthPortSetting = (): number => numberEnv('HEALTH_PORT', 3001);

export const postgresSettings = (): PostgresSettings => ({
  host: requiredEnv('DATABASE_HOST'),
  port: numberEnv('DATABASE_PORT', 5432),
  database: requiredEnv('DATABASE_NAME'),
  user: requiredEnv('DATABASE_USER'),
  password: requiredEnv('DATABASE_PASSWORD'),
});

export interface RedisSettings {
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly password: string;
}

export const redisSettings = (): RedisSettings => ({
  host: requiredEnv('REDIS_HOST'),
  port: numberEnv('REDIS_PORT', 6379),
  username: requiredEnv('REDIS_USER'),
  password: requiredEnv('REDIS_PASSWORD'),
});

/** Shared token every internal gRPC caller sends as `x-service-token`. */
export const grpcTokenSetting = (): string => requiredEnv('GRPC_TOKEN');

/** Ed25519 pair for the internal user JWT: account signs with the private key, every service verifies with the public one. */
export const userTokenKeysSetting = (): { privateKey: KeyObject; publicKey: KeyObject } => ({
  privateKey: userTokenPrivateKey(requiredEnv('USER_TOKEN_PRIVATE_KEY')),
  publicKey: userTokenPublicKey(requiredEnv('USER_TOKEN_PUBLIC_KEY')),
});

/** Only "false" turns Secure off, for a browser that reaches the edge over plain HTTP on a host it does not trust. */
export const secureCookieSetting = (env: NodeJS.ProcessEnv = process.env): boolean => env.SESSION_COOKIE_SECURE !== 'false';

const unitMs: ReadonlyMap<string, number> = new Map([
  ['s', 1_000],
  ['m', 60_000],
  ['h', 3_600_000],
]);
const limitFormat = /^(\d+)\/(\d+)([smh])$/;

/** Reads a rate limit written as "<requests>/<window>", e.g. "5/1h" or "600/1m". */
export const rateLimitSetting = (key: string, fallback: string, env: NodeJS.ProcessEnv = process.env): Omit<RateLimitPolicy, 'name'> => {
  const match = limitFormat.exec(env[key] ?? fallback);
  if (!match) throw new MissingConfigurationError(key);
  const [, limit, amount, unit] = match;
  return { limit: Number(limit), windowMs: Number(amount) * (unitMs.get(String(unit)) ?? 0) };
};

/** Host whose X-Forwarded-For is trusted: only the edge, resolved by name, so a direct caller never picks its own client IP. */
export const trustedProxyHostSetting = (env: NodeJS.ProcessEnv = process.env): string => env.TRUSTED_PROXY_HOST || 'edge';
