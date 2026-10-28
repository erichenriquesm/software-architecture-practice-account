import { createHash, randomBytes } from 'node:crypto';
import type { SessionTokens } from '../../application/contracts/sessionTokens.js';

export class RandomSessionTokens implements SessionTokens {
  generate(): string {
    return randomBytes(32).toString('base64url');
  }

  hashOf(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
