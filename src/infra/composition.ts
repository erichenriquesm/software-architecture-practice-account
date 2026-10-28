import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { KeyObject } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { Clock } from '../application/contracts/clock.js';
import type { IdGenerator } from '../application/contracts/idGenerator.js';
import type { LoginThrottle } from '../application/contracts/loginThrottle.js';
import type { PasswordHasher } from '../application/contracts/passwordHasher.js';
import { AccountExists } from '../application/usecases/accountExists.js';
import { GetAccount } from '../application/usecases/getAccount.js';
import { GetMe } from '../application/usecases/getMe.js';
import { IssueUserToken } from '../application/usecases/issueUserToken.js';
import { Login } from '../application/usecases/login.js';
import { Logout } from '../application/usecases/logout.js';
import { ProjectWalletBalance } from '../application/usecases/projectWalletBalance.js';
import { Signup } from '../application/usecases/signup.js';
import { Ed25519UserTokenSigner } from './crypto/ed25519UserTokenSigner.js';
import { RandomSessionTokens } from './crypto/sessionTokens.js';
import type { Database } from './database/database.js';
import { KyselyAccountDao } from './database/kyselyAccountDao.js';
import { KyselyAccountRepository } from './database/kyselyAccountRepository.js';
import { KyselyBalanceDao } from './database/kyselyBalanceDao.js';
import { KyselyBalanceProjection } from './database/kyselyBalanceProjection.js';
import { KyselySessionDao } from './database/kyselySessionDao.js';
import { KyselySessionRepository } from './database/kyselySessionRepository.js';
import { KyselyTransactionRunner } from './database/kyselyTransactionRunner.js';
import { PostgresProbe } from './database/postgres.js';
import type { AccountRateLimits } from './http/accountRoutes.js';
import { accountErrorMappings, accountRateLimitGroups, defaultAccountRateLimits, registerAccountRoutes } from './http/accountRoutes.js';
import { registerAuthRoutes } from './http/authRoutes.js';
import type { DependencyProbe } from './http/health.js';
import { registerHealthRoutes } from './http/health.js';
import { OutboxEventPublisher } from './messaging/outboxEventPublisher.js';
import { registerErrorMapping } from './platform/http/errors/errorMapping.js';
import type { RateLimiter } from './platform/http/rateLimit/rateLimiter.js';
import { registerRateLimit } from './platform/http/rateLimit/rateLimitPlugin.js';
import { registerUserTokenGuard } from './platform/security/userToken.js';
import { SystemClock, UuidV7Generator } from './system.js';

export const serviceName = 'account';

export interface AccountApiDependencies {
  readonly db: Kysely<Database>;
  readonly rateLimiter: RateLimiter;
  readonly passwordHasher: PasswordHasher;
  readonly loginThrottle: LoginThrottle;
  readonly userTokenKeys: UserTokenKeys;
  readonly secureCookie?: boolean;
  readonly rateLimits?: AccountRateLimits;
  readonly extraProbes?: readonly DependencyProbe[];
  readonly idGenerator?: IdGenerator;
  readonly clock?: Clock;
  readonly trustProxy?: string[] | boolean;
  readonly logger?: boolean;
}

export interface UserTokenKeys {
  readonly privateKey: KeyObject;
  readonly publicKey: KeyObject;
}

const publicRoutes: ReadonlySet<string> = new Set(['/health', '/signup', '/login', '/logout', '/internal/session']);

export const buildAccountCore = (db: Kysely<Database>) => {
  const runner = new KyselyTransactionRunner(db);
  const accountDao = new KyselyAccountDao(runner);
  return {
    runner,
    eventPublisher: new OutboxEventPublisher(runner),
    accountDao,
    balanceDao: new KyselyBalanceDao(runner),
    accountRepository: new KyselyAccountRepository(runner),
    accountExists: new AccountExists(accountDao),
    projectWalletBalance: new ProjectWalletBalance(new KyselyBalanceProjection(runner)),
  };
};

export const buildAccountApi = (dependencies: AccountApiDependencies): FastifyInstance => {
  const core = buildAccountCore(dependencies.db);
  const idGenerator = dependencies.idGenerator ?? new UuidV7Generator();
  const clock = dependencies.clock ?? new SystemClock();
  const signup = new Signup(
    core.accountRepository,
    dependencies.passwordHasher,
    core.runner,
    core.eventPublisher,
    idGenerator,
    clock,
  );
  const getAccount = new GetAccount(core.accountDao, core.balanceDao);
  const sessionTokens = new RandomSessionTokens();
  const sessionRepository = new KyselySessionRepository(core.runner);
  const login = new Login({
    accountRepository: core.accountRepository,
    passwordHasher: dependencies.passwordHasher,
    loginThrottle: dependencies.loginThrottle,
    sessionRepository,
    sessionTokens,
    idGenerator,
    clock,
  });
  const logout = new Logout(sessionRepository, sessionTokens, clock);
  const userTokenSigner = new Ed25519UserTokenSigner(dependencies.userTokenKeys.privateKey, idGenerator, clock);
  const issueUserToken = new IssueUserToken(new KyselySessionDao(core.runner), sessionTokens, userTokenSigner, clock);

  const app = Fastify({
    logger: dependencies.logger ?? false,
    trustProxy: dependencies.trustProxy ?? false,
    ajv: { customOptions: { removeAdditional: false } },
  });
  registerErrorMapping(app, accountErrorMappings);
  registerUserTokenGuard(app, { publicKey: dependencies.userTokenKeys.publicKey, audience: serviceName, publicRoutes });
  registerRateLimit(app, {
    limiter: dependencies.rateLimiter,
    groups: accountRateLimitGroups(dependencies.rateLimits ?? defaultAccountRateLimits),
  });
  registerHealthRoutes(app, serviceName, [new PostgresProbe(dependencies.db), ...(dependencies.extraProbes ?? [])]);
  registerAccountRoutes(app, { signup, getAccount });
  registerAuthRoutes(app, { login, logout, issueUserToken, getMe: new GetMe(core.accountDao) }, { secureCookie: dependencies.secureCookie ?? true });
  return app;
};
