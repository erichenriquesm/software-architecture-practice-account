export interface SessionDao {
  /** The account of a session that is neither expired nor revoked at `now`. */
  findActiveAccountId(tokenHash: string, now: Date): Promise<string | undefined>;
}
