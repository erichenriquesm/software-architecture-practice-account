import { describe, expect, test } from 'vitest';
import type { LoginThrottle } from '../../../../src/application/contracts/loginThrottle.js';
import type { SessionRepository } from '../../../../src/application/contracts/sessionRepository.js';
import { IssueUserToken } from '../../../../src/application/usecases/issueUserToken.js';
import { Login } from '../../../../src/application/usecases/login.js';
import { Logout } from '../../../../src/application/usecases/logout.js';
import type { Session } from '../../../../src/domain/entities/session.js';
import { InvalidCredentialsError, LoginBlockedError, UnauthenticatedError } from '../../../../src/domain/errors.js';
import { Password } from '../../../../src/domain/valueObjects/password.js';
import { FakeAccountRepository } from '../../../fakes/fakeAccountRepository.js';
import { FakePasswordHasher } from '../../../fakes/fakePasswordHasher.js';
import { fixedClock, fixedIds } from '../../../fakes/fixedSystem.js';

const accountId = '0199d5f4-2b9a-7c3e-9a51-2f1d3c4b5a69';
const sessionId = '0199d5f4-0000-7000-8000-00000000000a';
const now = new Date('2026-10-28T12:00:00Z');
const sessionTokens = { generate: () => 'token-1', hashOf: (token: string) => `hash(${token})` };

class RecordingThrottle implements LoginThrottle {
  readonly failures: string[] = [];
  readonly resets: string[] = [];
  constructor(private readonly blocked?: number) {}
  async blockedFor(): Promise<number | undefined> {
    return this.blocked;
  }
  async recordFailure(email: string, ip: string): Promise<void> {
    this.failures.push(`${email}@${ip}`);
  }
  async reset(email: string): Promise<void> {
    this.resets.push(email);
  }
}

class RecordingSessions implements SessionRepository {
  readonly saved: Session[] = [];
  readonly revoked: string[] = [];
  async save(session: Session): Promise<void> {
    this.saved.push(session);
  }
  async revoke(tokenHash: string): Promise<void> {
    this.revoked.push(tokenHash);
  }
}

const buildLogin = async (blocked?: number) => {
  const hasher = new FakePasswordHasher();
  const credentials = new Map([['ana@example.com', { accountId, passwordHash: await hasher.hash(Password.from('Abcdefg1')) }]]);
  const throttle = new RecordingThrottle(blocked);
  const sessions = new RecordingSessions();
  const login = new Login({
    accountRepository: new FakeAccountRepository([], credentials),
    passwordHasher: hasher,
    loginThrottle: throttle,
    sessionRepository: sessions,
    sessionTokens,
    idGenerator: fixedIds(sessionId),
    clock: fixedClock(now),
  });
  return { login, hasher, throttle, sessions };
};

describe('Use case: Login', () => {
  test('Should start a 12 h session for the right password, store only the token hash and clear the failures', async () => {
    // Given
    const { login, throttle, sessions } = await buildLogin();

    // When
    const loginOutput = await login.execute({ email: ' Ana@Example.com', password: 'Abcdefg1', ip: '10.0.0.1' });

    // Then
    expect(loginOutput).toEqual({ sessionToken: 'token-1', expiresAt: new Date('2026-10-29T00:00:00Z') });
    expect(sessions.saved).toMatchObject([{ sessionId, accountId, tokenHash: 'hash(token-1)', createdAt: now }]);
    expect(throttle.resets).toEqual(['ana@example.com']);
  });

  test('Should refuse a wrong password and an unknown email the same way, both checked by the hasher', async () => {
    // Given
    const { login, hasher, throttle } = await buildLogin();

    // When & Then
    await expect(login.execute({ email: 'ana@example.com', password: 'Abcdefg2', ip: '10.0.0.1' })).rejects.toBeInstanceOf(InvalidCredentialsError);
    await expect(login.execute({ email: 'bob@example.com', password: 'Abcdefg1', ip: '10.0.0.1' })).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(hasher.verified).toHaveLength(2);
    expect(throttle.failures).toEqual(['ana@example.com@10.0.0.1', 'bob@example.com@10.0.0.1']);
  });

  test('Should not even check the password while the email or IP is blocked', async () => {
    // Given
    const { login, hasher } = await buildLogin(300);

    // When & Then
    await expect(login.execute({ email: 'ana@example.com', password: 'Abcdefg1', ip: '10.0.0.1' })).rejects.toEqual(new LoginBlockedError(300));
    expect(hasher.verified).toHaveLength(0);
  });
});

describe('Use cases: Logout and IssueUserToken', () => {
  test('Should revoke by the token hash and ignore a request without a session', async () => {
    // Given
    const sessions = new RecordingSessions();
    const logout = new Logout(sessions, sessionTokens, fixedClock(now));

    // When
    await logout.execute({ sessionToken: 'token-1' });
    await logout.execute({ sessionToken: undefined });

    // Then
    expect(sessions.revoked).toEqual(['hash(token-1)']);
  });

  test('Should sign a token for the active session and refuse a missing or dead one', async () => {
    // Given
    const sessionDao = { findActiveAccountId: async (hash: string) => (hash === 'hash(live)' ? accountId : undefined) };
    const signer = { sign: (sub: string, audience: string) => `${sub}->${audience}` };
    const issue = new IssueUserToken(sessionDao, sessionTokens, signer, fixedClock(now));

    // When & Then
    await expect(issue.execute({ sessionToken: 'live', audience: 'wallet' })).resolves.toEqual({ userToken: `${accountId}->wallet` });
    await expect(issue.execute({ sessionToken: 'dead', audience: 'wallet' })).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(issue.execute({ sessionToken: undefined, audience: 'wallet' })).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});
