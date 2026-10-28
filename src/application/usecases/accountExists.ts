import { AccountId } from '../../domain/valueObjects/accountId.js';
import type { AccountDao } from '../contracts/accountDao.js';

export class AccountExists {
  constructor(private readonly accountDao: AccountDao) {}

  async execute(accountId: string): Promise<boolean> {
    return this.accountDao.exists(AccountId.from(accountId).value);
  }
}
