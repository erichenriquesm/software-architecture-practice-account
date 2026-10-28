import type { Account } from '../../domain/entities/account.js';
import type { Email } from '../../domain/valueObjects/email.js';
import type { PasswordHash } from '../../domain/valueObjects/passwordHash.js';

export interface AccountCredentials {
  readonly accountId: string;
  readonly passwordHash: PasswordHash;
}

export interface AccountRepository {
  existsByEmail(email: Email): Promise<boolean>;
  /** Looked up by the email as typed, lower-cased; no validation, so a malformed email simply finds nothing. */
  findCredentialsByEmail(email: string): Promise<AccountCredentials | undefined>;
  save(account: Account): Promise<void>;
}
