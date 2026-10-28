import { AccountNotFoundError } from '../../domain/errors.js';
import type { AccountDao } from '../contracts/accountDao.js';

export interface GetMeInput {
  readonly accountId: string;
}

export interface GetMeOutput {
  readonly accountId: string;
  readonly name: string;
  readonly email: string;
}

export class GetMe {
  constructor(private readonly accountDao: AccountDao) {}

  async execute(input: GetMeInput): Promise<GetMeOutput> {
    const account = await this.accountDao.findById(input.accountId);
    if (!account) throw new AccountNotFoundError(input.accountId);
    return { accountId: account.accountId, name: account.name, email: account.email };
  }
}
