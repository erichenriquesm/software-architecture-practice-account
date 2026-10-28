import type { Clock } from '../contracts/clock.js';
import type { SessionRepository } from '../contracts/sessionRepository.js';
import type { SessionTokens } from '../contracts/sessionTokens.js';

export interface LogoutInput {
  readonly sessionToken: string | undefined;
}

/** Idempotent: an unknown or already revoked session ends the same way. */
export class Logout {
  constructor(
    private readonly sessionRepository: SessionRepository,
    private readonly sessionTokens: SessionTokens,
    private readonly clock: Clock,
  ) {}

  async execute(input: LogoutInput): Promise<void> {
    if (input.sessionToken === undefined) return;
    await this.sessionRepository.revoke(this.sessionTokens.hashOf(input.sessionToken), this.clock.now());
  }
}
