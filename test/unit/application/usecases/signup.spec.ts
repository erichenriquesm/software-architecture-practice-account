import { describe, expect, test } from 'vitest';
import { FakeAccountRepository } from '../../../fakes/fakeAccountRepository.js';
import { FakePasswordHasher } from '../../../fakes/fakePasswordHasher.js';
import { fixedClock, fixedIds } from '../../../fakes/fixedSystem.js';
import { RecordingEventPublisher } from '../../../fakes/recordingEventPublisher.js';
import { RecordingTransactionRunner } from '../../../fakes/recordingTransactionRunner.js';
import { DuplicateEmailError, InvalidAccountDataError } from '../../../../src/domain/errors.js';
import { Signup } from '../../../../src/application/usecases/signup.js';

const accountId = '0199d5f4-2b9a-7c3e-9a51-2f1d3c4b5a69';
const fixedNow = new Date('2026-10-27T12:00:00Z');
const signupInput = { name: 'Ana Souza', email: 'Ana@Example.com', document: '529.982.247-25', password: 'Abcdefg1' };

const buildSignup = (takenEmails: readonly string[] = []) => {
  const repository = new FakeAccountRepository(takenEmails);
  const transactionRunner = new RecordingTransactionRunner();
  const eventPublisher = new RecordingEventPublisher();
  const signup = new Signup(repository, new FakePasswordHasher(), transactionRunner, eventPublisher, fixedIds(accountId), fixedClock(fixedNow));
  return { signup, repository, transactionRunner, eventPublisher };
};

describe('Use case: Signup', () => {
  test('Should create the account, hash the password and publish AccountCreated in one transaction', async () => {
    // Given
    const { signup, repository, transactionRunner, eventPublisher } = buildSignup();

    // When
    const createdAccountId = await signup.execute(signupInput);

    // Then
    expect(createdAccountId).toBe(accountId);
    expect(repository.saved).toHaveLength(1);
    expect(repository.saved[0]?.email.value).toBe('ana@example.com');
    expect(repository.saved[0]?.passwordHash.value).not.toContain('Abcdefg1');
    expect(transactionRunner.runs).toBe(1);
    expect(eventPublisher.published).toEqual([{ type: 'AccountCreated', accountId, occurredAt: fixedNow }]);
  });

  test('Should refuse an email that is already registered', async () => {
    // Given
    const { signup, repository, eventPublisher } = buildSignup(['ana@example.com']);

    // When & Then
    await expect(signup.execute(signupInput)).rejects.toBeInstanceOf(DuplicateEmailError);
    expect(repository.saved).toHaveLength(0);
    expect(eventPublisher.published).toHaveLength(0);
  });

  test.each([
    ['name', { name: 'Ana' }],
    ['email', { email: 'ana' }],
    ['document', { document: '111.111.111-11' }],
    ['password', { password: 'weak' }],
  ])('Should reject invalid %s before touching anything', async (field, change) => {
    // Given
    const { signup, repository } = buildSignup();

    // When & Then
    await expect(signup.execute({ ...signupInput, ...change })).rejects.toMatchObject({ field });
    await expect(signup.execute({ ...signupInput, ...change })).rejects.toBeInstanceOf(InvalidAccountDataError);
    expect(repository.saved).toHaveLength(0);
  });
});
