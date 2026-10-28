import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { GetMe } from '../../application/usecases/getMe.js';
import type { IssueUserToken } from '../../application/usecases/issueUserToken.js';
import type { Login } from '../../application/usecases/login.js';
import type { Logout } from '../../application/usecases/logout.js';
import { sessionLifetimeMs } from '../../domain/entities/session.js';
import { cookieValue, setCookie } from '../platform/http/cookies.js';
import { userAccountIdOf } from '../platform/security/userToken.js';

export const sessionCookieName = 'session';
export const userTokenHeader = 'x-user-token';
export const audienceHeader = 'x-audience';

/** Services the edge may ask a user token for. */
export const userTokenAudiences: ReadonlySet<string> = new Set(['account', 'wallet', 'order']);

const loginBody = {
  type: 'object',
  required: ['email', 'password'],
  additionalProperties: false,
  properties: {
    email: { type: 'string', maxLength: 254 },
    password: { type: 'string', maxLength: 128 },
  },
} as const;

export interface AuthRouteUseCases {
  readonly login: Login;
  readonly logout: Logout;
  readonly issueUserToken: IssueUserToken;
  readonly getMe: GetMe;
}

export interface AuthRouteOptions {
  readonly secureCookie: boolean;
}

const sessionTokenOf = (request: FastifyRequest): string | undefined => cookieValue(request.headers.cookie, sessionCookieName);

export const registerAuthRoutes = (app: FastifyInstance, useCases: AuthRouteUseCases, options: AuthRouteOptions): void => {
  const sessionCookie = (value: string, maxAgeSeconds: number) => setCookie(sessionCookieName, value, { maxAgeSeconds, secure: options.secureCookie });

  app.post('/login', { schema: { body: loginBody } }, async (request, reply) => {
    const { email, password } = request.body as { email: string; password: string };
    const loginOutput = await useCases.login.execute({ email, password, ip: request.ip });
    return reply.status(204).header('set-cookie', sessionCookie(loginOutput.sessionToken, sessionLifetimeMs / 1_000)).send();
  });

  app.post('/logout', async (request, reply) => {
    await useCases.logout.execute({ sessionToken: sessionTokenOf(request) });
    return reply.status(204).header('set-cookie', sessionCookie('', 0)).send();
  });

  app.get('/me', async (request) => useCases.getMe.execute({ accountId: userAccountIdOf(request) }));

  app.get('/internal/session', async (request, reply) => {
    const audience = String(request.headers[audienceHeader] ?? '');
    if (!userTokenAudiences.has(audience)) return reply.status(400).send({ error: 'invalidAudience', message: `unknown audience "${audience}"` });
    const issueUserTokenOutput = await useCases.issueUserToken.execute({ sessionToken: sessionTokenOf(request), audience });
    return reply.status(204).header(userTokenHeader, issueUserTokenOutput.userToken).send();
  });
};
