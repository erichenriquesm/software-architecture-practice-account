export interface BalanceChange {
  readonly accountId: string;
  readonly assetId: string;
  readonly available: string;
  readonly reserved: string;
  readonly version: number;
}

export interface BalanceProjection {
  applyIfNewer(change: BalanceChange): Promise<boolean>;
}
