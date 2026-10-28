import { describe, expect, test } from 'vitest';
import { cookieValue, setCookie } from '../../../../../src/infra/platform/http/cookies.js';

describe('Cookies', () => {
  test('Should read one cookie among several and nothing when it is absent or empty', () => {
    expect(cookieValue('theme=dark; session=abc_-1; other=x', 'session')).toBe('abc_-1');
    expect(cookieValue('theme=dark', 'session')).toBeUndefined();
    expect(cookieValue('session=', 'session')).toBeUndefined();
    expect(cookieValue(undefined, 'session')).toBeUndefined();
  });

  test('Should write an HttpOnly, SameSite=Strict cookie, Secure only when asked', () => {
    expect(setCookie('session', 'abc', { maxAgeSeconds: 60, secure: true })).toBe('session=abc; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=60');
    expect(setCookie('session', '', { maxAgeSeconds: 0, secure: false })).toBe('session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  });
});
