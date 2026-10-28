import type { KeyObject } from 'node:crypto';
import type { Clock } from '../../application/contracts/clock.js';
import type { IdGenerator } from '../../application/contracts/idGenerator.js';
import type { UserTokenSigner } from '../../application/contracts/userTokenSigner.js';
import { signUserToken, userTokenIssuer } from '../platform/security/userToken.js';

export const userTokenLifetimeSeconds = 60;

export class Ed25519UserTokenSigner implements UserTokenSigner {
  constructor(
    private readonly privateKey: KeyObject,
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock,
  ) {}

  sign(accountId: string, audience: string): string {
    const iat = Math.floor(this.clock.now().getTime() / 1_000);
    const claims = { iss: userTokenIssuer, sub: accountId, aud: audience, iat, exp: iat + userTokenLifetimeSeconds, jti: this.idGenerator.next() };
    return signUserToken(claims, this.privateKey);
  }
}
