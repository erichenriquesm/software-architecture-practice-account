import { describe, expect, test } from 'vitest';
import { FakeAccountDao } from '../../../fakes/fakeAccountDao.js';
import { balanceDaoReturning } from '../../../fakes/fakeBalanceDao.js';
import { AccountNotFoundError } from '../../../../src/domain/errors.js';
import type { AccountView } from '../../../../src/application/contracts/accountDao.js';
import { GetAccount } from '../../../../src/application/usecases/getAccount.js';

const accountId = '0199d5f4-2b9a-7c3e-9a51-2f1d3c4b5a69';
const accountView: AccountView = { accountId, name: 'Ana Souza', email: 'ana@example.com', document: '52998224725' };

describe('Use case: GetAccount', () => {
  test('Should return the account with quantity = available + reserved from the projected balances', async () => {
    // Given
    const getAccount = new GetAccount(
      new FakeAccountDao(accountView),
      balanceDaoReturning([{ assetId: 'USD', available: '100.5', reserved: '20.25' }]),
    );

    // When
    const getAccountOutput = await getAccount.execute(accountId);

    // Then
    expect(getAccountOutput).toEqual({
      ...accountView,
      assets: [{ assetId: 'USD', quantity: '120.75000000', available: '100.50000000', reserved: '20.25000000' }],
    });
  });

  test('Should answer with an empty asset list when nothing was projected yet', async () => {
    // Given
    const getAccount = new GetAccount(new FakeAccountDao(accountView), balanceDaoReturning([]));

    // When
    const getAccountOutput = await getAccount.execute(accountId);

    // Then
    expect(getAccountOutput).toEqual({ ...accountView, assets: [] });
  });

  test('Should fail with AccountNotFoundError for an unknown account', async () => {
    // Given
    const getAccount = new GetAccount(new FakeAccountDao(), balanceDaoReturning([]));

    // When & Then
    await expect(getAccount.execute(accountId)).rejects.toBeInstanceOf(AccountNotFoundError);
  });
});
