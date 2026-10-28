import { Session } from '../../domain/entities/session.js';
import { InvalidCredentialsError, LoginBlockedError } from '../../domain/errors.js';
import type { AccountRepository } from '../contracts/accountRepository.js';
import type { Clock } from '../contracts/clock.js';
import type { IdGenerator } from '../contracts/idGenerator.js';
import type { LoginThrottle } from '../contracts/loginThrottle.js';
import type { PasswordHasher } from '../contracts/passwordHasher.js';
import type { SessionRepository } from '../contracts/sessionRepository.js';
import type { SessionTokens } from '../contracts/sessionTokens.js';

export interface LoginInput {
  readonly email: string;
  readonly password: string;
  readonly ip: string;
}

export interface LoginOutput {
  readonly sessionToken: string;
  readonly expiresAt: Date;
}

export interface LoginDependencies {
  readonly accountRepository: AccountRepository;
  readonly passwordHasher: PasswordHasher;
  readonly loginThrottle: LoginThrottle;
  readonly sessionRepository: SessionRepository;
  readonly sessionTokens: SessionTokens;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

export class Login {
  constructor(private readonly dependencies: LoginDependencies) {}

  async execute(input: LoginInput): Promise<LoginOutput> {
    const { accountRepository, passwordHasher, loginThrottle } = this.dependencies;
    const email = input.email.trim().toLowerCase();
    const blockedSeconds = await loginThrottle.blockedFor(email, input.ip);
    if (blockedSeconds !== undefined) throw new LoginBlockedError(blockedSeconds);

    const credentials = await accountRepository.findCredentialsByEmail(email);
    const valid = await passwordHasher.verify(input.password, credentials?.passwordHash);
    if (!credentials || !valid) {
      await loginThrottle.recordFailure(email, input.ip);
      throw new InvalidCredentialsError();
    }

    await loginThrottle.reset(email);
    return this.startSession(credentials.accountId);
  }

  private async startSession(accountId: string): Promise<LoginOutput> {
    const { sessionRepository, sessionTokens, idGenerator, clock } = this.dependencies;
    const sessionToken = sessionTokens.generate();
    const session = Session.start({ sessionId: idGenerator.next(), accountId, tokenHash: sessionTokens.hashOf(sessionToken), now: clock.now() });
    await sessionRepository.save(session);
    return { sessionToken, expiresAt: session.expiresAt };
  }
}
