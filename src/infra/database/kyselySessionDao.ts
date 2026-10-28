import type { SessionDao } from '../../application/contracts/sessionDao.js';
import type { Database } from './database.js';
import type { KyselyTransactionRunner } from './kyselyTransactionRunner.js';

export class KyselySessionDao implements SessionDao {
  constructor(private readonly runner: KyselyTransactionRunner<Database>) {}

  async findActiveAccountId(tokenHash: string, now: Date): Promise<string | undefined> {
    const row = await this.runner
      .executor()
      .selectFrom('session')
      .select('account_id')
      .where('token_hash', '=', tokenHash)
      .where('revoked_at', 'is', null)
      .where('expires_at', '>', now)
      .executeTakeFirst();
    return row?.account_id;
  }
}
