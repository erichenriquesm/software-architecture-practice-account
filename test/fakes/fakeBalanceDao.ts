import type { BalanceDao, BalanceView } from '../../src/application/contracts/balanceDao.js';

export const balanceDaoReturning = (balances: BalanceView[]): BalanceDao => ({ listByAccount: async () => balances });
