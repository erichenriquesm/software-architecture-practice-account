import { generateKeyPairSync } from 'node:crypto';
import { signUserToken, userTokenIssuer } from '../../src/infra/platform/security/userToken.js';
import type { UserTokenClaims } from '../../src/infra/platform/security/userToken.js';

export const testUserTokenKeys = generateKeyPairSync('ed25519');

export const nowSeconds = (): number => Math.floor(Date.now() / 1_000);

export const userToken = (accountId: string, overrides: Partial<UserTokenClaims> = {}): string => {
  const iat = nowSeconds();
  return signUserToken({ iss: userTokenIssuer, sub: accountId, aud: 'account', iat, exp: iat + 60, jti: 'test', ...overrides }, testUserTokenKeys.privateKey);
};

export const bearer = (accountId: string, overrides: Partial<UserTokenClaims> = {}): { authorization: string } => ({
  authorization: `Bearer ${userToken(accountId, overrides)}`,
});
