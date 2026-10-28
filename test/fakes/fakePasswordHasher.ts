import type { PasswordHasher } from '../../src/application/contracts/passwordHasher.js';
import type { Password } from '../../src/domain/valueObjects/password.js';
import { PasswordHash } from '../../src/domain/valueObjects/passwordHash.js';

/** Instant stand-in for argon2: unit tests stay fast and the hash never contains the password. */
export class FakePasswordHasher implements PasswordHasher {
  readonly verified: Array<string | undefined> = [];

  async hash(password: Password): Promise<PasswordHash> {
    return PasswordHash.from(`$argon2id$fake$${password.value.length}$${[...password.value].reverse().join('')}`);
  }

  async verify(password: string, hash: PasswordHash | undefined): Promise<boolean> {
    this.verified.push(hash?.value);
    return hash !== undefined && hash.value.endsWith(`$${[...password].reverse().join('')}`);
  }
}
