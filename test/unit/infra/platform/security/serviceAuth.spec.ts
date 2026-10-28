import grpc from '@grpc/grpc-js';
import { describe, expect, test } from 'vitest';
import { hasServiceToken, serviceTokenHeader } from '../../../../../src/infra/platform/security/serviceAuth.js';

const metadataWith = (token?: string): grpc.Metadata => {
  const metadata = new grpc.Metadata();
  if (token !== undefined) metadata.set(serviceTokenHeader, token);
  return metadata;
};

describe('hasServiceToken', () => {
  test('Should accept the shared token sent as x-service-token', () => {
    // When & Then
    expect(hasServiceToken('internal-grpc-dev', metadataWith('internal-grpc-dev'))).toBe(true);
  });

  test.each([
    ['a wrong token', 'other-token'],
    ['a token with a different length', 'internal'],
    ['an empty token', ''],
    ['no token', undefined],
  ])('Should refuse %s', (_case, token) => {
    // When & Then
    expect(hasServiceToken('internal-grpc-dev', metadataWith(token))).toBe(false);
  });
});
