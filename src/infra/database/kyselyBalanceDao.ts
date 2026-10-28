import type { BalanceDao, BalanceView } from '../../application/contracts/balanceDao.js';
import type { KyselyTransactionRunner } from './kyselyTransactionRunner.js';
import type { Database } from './database.js';

export class KyselyBalanceDao implements BalanceDao {
  constructor(private readonly runner: KyselyTransactionRunner<Database>) {}

  async listByAccount(accountId: string): Promise<BalanceView[]> {
    return this.runner
      .executor()
      .selectFrom('account_balance_view')
      .select(['asset_id as assetId', 'available', 'reserved'])
      .where('account_id', '=', accountId)
      .orderBy('asset_id')
      .execute();
  }
}
