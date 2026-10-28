export interface BalanceView {
  readonly assetId: string;
  readonly available: string;
  readonly reserved: string;
}

export interface BalanceDao {
  listByAccount(accountId: string): Promise<BalanceView[]>;
}
