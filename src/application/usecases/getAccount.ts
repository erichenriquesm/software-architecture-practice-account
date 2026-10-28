import { Decimal } from 'decimal.js';
import { AccountNotFoundError } from '../../domain/errors.js';
import { AccountId } from '../../domain/valueObjects/accountId.js';
import type { AccountDao } from '../contracts/accountDao.js';
import type { BalanceDao, BalanceView } from '../contracts/balanceDao.js';

export interface AssetOutput {
  readonly assetId: string;
  readonly quantity: string;
  readonly available: string;
  readonly reserved: string;
}

export interface GetAccountOutput {
  readonly accountId: string;
  readonly name: string;
  readonly email: string;
  readonly document: string;
  readonly assets: readonly AssetOutput[];
}

const scale = 8;

const assetOutputOf = (balance: BalanceView): AssetOutput => ({
  assetId: balance.assetId,
  quantity: new Decimal(balance.available).plus(balance.reserved).toFixed(scale),
  available: new Decimal(balance.available).toFixed(scale),
  reserved: new Decimal(balance.reserved).toFixed(scale),
});

/** Balances come only from the local projection of wallet.balanceChanged; an account without rows has none yet. */
export class GetAccount {
  constructor(
    private readonly accountDao: AccountDao,
    private readonly balanceDao: BalanceDao,
  ) {}

  async execute(rawAccountId: string): Promise<GetAccountOutput> {
    const accountId = AccountId.from(rawAccountId).value;
    const account = await this.accountDao.findById(accountId);
    if (!account) throw new AccountNotFoundError(accountId);

    const balances = await this.balanceDao.listByAccount(accountId);
    return { ...account, assets: balances.map(assetOutputOf) };
  }
}
