/** The value of one cookie from a Cookie header; undefined when absent or empty. */
export const cookieValue = (header: string | undefined, name: string): string | undefined => {
  if (!header) return undefined;
  const pair = header
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  const value = pair?.slice(name.length + 1);
  return value ? decodeURIComponent(value) : undefined;
};

export interface CookieOptions {
  readonly maxAgeSeconds: number;
  readonly secure: boolean;
}

/** HttpOnly so scripts never read it, SameSite=Strict so other sites never send it. */
export const setCookie = (name: string, value: string, options: CookieOptions): string =>
  [`${name}=${encodeURIComponent(value)}`, 'HttpOnly', options.secure ? 'Secure' : undefined, 'SameSite=Strict', 'Path=/', `Max-Age=${options.maxAgeSeconds}`]
    .filter((part) => part !== undefined)
    .join('; ');
