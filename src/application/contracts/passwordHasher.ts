import type { Password } from '../../domain/valueObjects/password.js';
import type { PasswordHash } from '../../domain/valueObjects/passwordHash.js';

export interface PasswordHasher {
  hash(password: Password): Promise<PasswordHash>;
  /** Without a hash (unknown email) it still spends the same time and answers false. */
  verify(password: string, hash: PasswordHash | undefined): Promise<boolean>;
}
