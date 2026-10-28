import type { BalanceChange, BalanceProjection } from '../contracts/balanceProjection.js';

export class ProjectWalletBalance {
  constructor(private readonly balanceProjection: BalanceProjection) {}

  async execute(change: BalanceChange): Promise<boolean> {
    return this.balanceProjection.applyIfNewer(change);
  }
}
