import { Redis } from 'ioredis';
import { buildAccountApi, buildAccountCore, serviceName } from './composition.js';
import { Argon2PasswordHasher } from './crypto/argon2PasswordHasher.js';
import { createDatabase } from './database/postgres.js';
import { startAccountGrpcServer } from './grpc/accountGrpcServer.js';
import { RedisRateLimiter } from './platform/http/rateLimit/rateLimiter.js';
import {
  apiPortSetting,
  grpcPortSetting,
  grpcTokenSetting,
  postgresSettings,
  rateLimitSetting,
  redisSettings,
  trustedProxySubnets,
} from './settings.js';

const db = createDatabase(postgresSettings());
const redis = new Redis({
  ...redisSettings(),
  enableOfflineQueue: false,
  commandTimeout: 100,
  maxRetriesPerRequest: 1,
}).on('error', () => undefined);

const app = buildAccountApi({
  db,
  rateLimiter: new RedisRateLimiter(redis, serviceName),
  rateLimits: {
    authPerIp: rateLimitSetting('RATE_LIMITS_AUTH_PER_IP', '5/1h'),
    authPerEmail: rateLimitSetting('RATE_LIMITS_AUTH_PER_EMAIL', '3/1h'),
    privateReadPerIp: rateLimitSetting('RATE_LIMITS_PRIVATE_READ_PER_IP', '600/1m'),
    privateReadPerAccount: rateLimitSetting('RATE_LIMITS_PRIVATE_READ_PER_ACCOUNT', '300/1m'),
  },
  passwordHasher: new Argon2PasswordHasher(),
  trustProxy: trustedProxySubnets(),
  logger: true,
});

const grpcServer = await startAccountGrpcServer({
  accountExists: buildAccountCore(db).accountExists,
  token: grpcTokenSetting(),
  address: `0.0.0.0:${grpcPortSetting()}`,
  onDenied: (method) => app.log.warn({ method }, 'grpc call denied'),
});

const shutdown = async (): Promise<void> => {
  grpcServer.server.forceShutdown();
  await app.close();
  redis.disconnect();
  await db.destroy();
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);

await app.listen({ host: '0.0.0.0', port: apiPortSetting() });
