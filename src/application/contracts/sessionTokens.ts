export interface SessionTokens {
  generate(): string;
  hashOf(token: string): string;
}
