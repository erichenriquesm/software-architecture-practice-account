import type { SessionRepository } from '../../application/contracts/sessionRepository.js';
import type { Session } from '../../domain/entities/session.js';
import type { Database } from './database.js';
import type { KyselyTransactionRunner } from './kyselyTransactionRunner.js';

export class KyselySessionRepository implements SessionRepository {
  constructor(private readonly runner: KyselyTransactionRunner<Database>) {}

  async save(session: Session): Promise<void> {
    await this.runner
      .executor()
      .insertInto('session')
      .values({
        session_id: session.sessionId,
        account_id: session.accountId,
        token_hash: session.tokenHash,
        created_at: session.createdAt,
        expires_at: session.expiresAt,
        revoked_at: null,
      })
      .execute();
  }

  async revoke(tokenHash: string, now: Date): Promise<void> {
    await this.runner
      .executor()
      .updateTable('session')
      .set({ revoked_at: now })
      .where('token_hash', '=', tokenHash)
      .where('revoked_at', 'is', null)
      .execute();
  }
}
