import { UnauthenticatedError } from '../../domain/errors.js';
import type { Clock } from '../contracts/clock.js';
import type { SessionDao } from '../contracts/sessionDao.js';
import type { SessionTokens } from '../contracts/sessionTokens.js';
import type { UserTokenSigner } from '../contracts/userTokenSigner.js';

export interface IssueUserTokenInput {
  readonly sessionToken: string | undefined;
  readonly audience: string;
}

export interface IssueUserTokenOutput {
  readonly userToken: string;
}

export class IssueUserToken {
  constructor(
    private readonly sessionDao: SessionDao,
    private readonly sessionTokens: SessionTokens,
    private readonly userTokenSigner: UserTokenSigner,
    private readonly clock: Clock,
  ) {}

  async execute(input: IssueUserTokenInput): Promise<IssueUserTokenOutput> {
    if (input.sessionToken === undefined) throw new UnauthenticatedError('no session');
    const accountId = await this.sessionDao.findActiveAccountId(this.sessionTokens.hashOf(input.sessionToken), this.clock.now());
    if (accountId === undefined) throw new UnauthenticatedError('session expired or revoked');
    return { userToken: this.userTokenSigner.sign(accountId, input.audience) };
  }
}
