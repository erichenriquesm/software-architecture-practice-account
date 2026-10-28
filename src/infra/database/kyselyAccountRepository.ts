import { sql } from 'kysely';
import type { AccountCredentials, AccountRepository } from '../../application/contracts/accountRepository.js';
import type { Account } from '../../domain/entities/account.js';
import { DuplicateEmailError } from '../../domain/errors.js';
import type { Email } from '../../domain/valueObjects/email.js';
import { PasswordHash } from '../../domain/valueObjects/passwordHash.js';
import type { KyselyTransactionRunner } from './kyselyTransactionRunner.js';
import type { Database } from './database.js';

const uniqueViolation = '23505';
const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === uniqueViolation;

export class KyselyAccountRepository implements AccountRepository {
  constructor(private readonly runner: KyselyTransactionRunner<Database>) {}

  async existsByEmail(email: Email): Promise<boolean> {
    const row = await this.runner
      .executor()
      .selectFrom('account')
      .select('account_id')
      .where(sql<string>`lower(email)`, '=', email.value)
      .executeTakeFirst();
    return row !== undefined;
  }

  async findCredentialsByEmail(email: string): Promise<AccountCredentials | undefined> {
    const row = await this.runner
      .executor()
      .selectFrom('account')
      .select(['account_id', 'password_hash'])
      .where(sql<string>`lower(email)`, '=', email.toLowerCase())
      .executeTakeFirst();
    if (!row) return undefined;
    return { accountId: row.account_id, passwordHash: PasswordHash.from(row.password_hash) };
  }

  async save(account: Account): Promise<void> {
    try {
      await this.runner
        .executor()
        .insertInto('account')
        .values({
          account_id: account.id.value,
          name: account.name.value,
          email: account.email.value,
          document: account.document.value,
          password_hash: account.passwordHash.value,
          created_at: account.createdAt,
        })
        .execute();
    } catch (error) {
      if (isUniqueViolation(error)) throw new DuplicateEmailError();
      throw error;
    }
  }
}
