export interface AccountView {
  readonly accountId: string;
  readonly name: string;
  readonly email: string;
  readonly document: string;
}

export interface AccountDao {
  findById(accountId: string): Promise<AccountView | undefined>;
  exists(accountId: string): Promise<boolean>;
}
