import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { PasswordHasher } from '../../application/contracts/passwordHasher.js';
import { Password } from '../../domain/valueObjects/password.js';
import { PasswordHash } from '../../domain/valueObjects/passwordHash.js';

const argon2Async = promisify(argon2);

export interface Argon2Parameters {
  readonly memoryKib: number;
  readonly passes: number;
  readonly parallelism: number;
}

export const owaspArgon2Parameters: Argon2Parameters = { memoryKib: 19_456, passes: 2, parallelism: 1 };

const base64 = (buffer: Buffer): string => buffer.toString('base64').replace(/=+$/, '');
const encoded = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

interface ParsedHash {
  readonly parameters: Argon2Parameters;
  readonly salt: Buffer;
  readonly digest: Buffer;
}

const parse = (hash: string): ParsedHash | undefined => {
  const match = encoded.exec(hash);
  if (!match) return undefined;
  const [, memoryKib, passes, parallelism, salt, digest] = match;
  return {
    parameters: { memoryKib: Number(memoryKib), passes: Number(passes), parallelism: Number(parallelism) },
    salt: Buffer.from(String(salt), 'base64'),
    digest: Buffer.from(String(digest), 'base64'),
  };
};

export class Argon2PasswordHasher implements PasswordHasher {
  constructor(private readonly parameters: Argon2Parameters = owaspArgon2Parameters) {}

  private decoy: Promise<PasswordHash> | undefined;

  async hash(password: Password): Promise<PasswordHash> {
    const salt = randomBytes(16);
    const digest = await this.digest(password.value, salt, this.parameters);
    const { memoryKib, passes, parallelism } = this.parameters;
    return PasswordHash.from(`$argon2id$v=19$m=${memoryKib},t=${passes},p=${parallelism}$${base64(salt)}$${base64(digest)}`);
  }

  async verify(password: string, hash: PasswordHash | undefined): Promise<boolean> {
    const parsed = parse((hash ?? (await this.decoyHash())).value);
    if (!parsed) return false;
    const digest = await this.digest(password, parsed.salt, parsed.parameters);
    const matches = digest.length === parsed.digest.length && timingSafeEqual(digest, parsed.digest);
    return hash !== undefined && matches;
  }

  /** An unknown email is checked against this hash, so it costs the same time as a real one. */
  private decoyHash(): Promise<PasswordHash> {
    this.decoy ??= this.hash(Password.from(`Decoy9${randomBytes(12).toString('hex')}`));
    return this.decoy;
  }

  private digest(message: string, salt: Buffer, parameters: Argon2Parameters): Promise<Buffer> {
    return argon2Async('argon2id', {
      message,
      nonce: salt,
      memory: parameters.memoryKib,
      passes: parameters.passes,
      parallelism: parameters.parallelism,
      tagLength: 32,
    });
  }
}
