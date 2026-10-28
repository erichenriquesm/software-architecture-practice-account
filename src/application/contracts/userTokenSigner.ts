export interface UserTokenSigner {
  /** The short-lived internal JWT the edge forwards to `audience`. */
  sign(accountId: string, audience: string): string;
}
