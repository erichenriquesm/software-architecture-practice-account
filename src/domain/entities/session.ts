export const sessionLifetimeMs = 12 * 60 * 60 * 1_000;

export interface StartSessionData {
  readonly sessionId: string;
  readonly accountId: string;
  readonly tokenHash: string;
  readonly now: Date;
}

/** A login. Only the hash of its token is kept: the token itself lives in the user's cookie. */
export class Session {
  private constructor(
    readonly sessionId: string,
    readonly accountId: string,
    readonly tokenHash: string,
    readonly createdAt: Date,
    readonly expiresAt: Date,
  ) {}

  static start(data: StartSessionData): Session {
    return new Session(data.sessionId, data.accountId, data.tokenHash, data.now, new Date(data.now.getTime() + sessionLifetimeMs));
  }
}
