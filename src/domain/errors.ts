export class InvalidAccountDataError extends Error {
  constructor(
    readonly field: string,
    reason: string,
  ) {
    super(`${field}: ${reason}`);
    this.name = 'InvalidAccountDataError';
  }
}

export class DuplicateEmailError extends Error {
  constructor() {
    super('email already registered');
    this.name = 'DuplicateEmailError';
  }
}

export class AccountNotFoundError extends Error {
  constructor(readonly accountId: string) {
    super(`account ${accountId} not found`);
    this.name = 'AccountNotFoundError';
  }
}

/** Same answer for a wrong password and an unknown email, so a login never reveals which emails exist. */
export class InvalidCredentialsError extends Error {
  constructor() {
    super('invalid email or password');
    this.name = 'InvalidCredentialsError';
  }
}

export class LoginBlockedError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super(`too many login attempts, retry in ${retryAfterSeconds}s`);
    this.name = 'LoginBlockedError';
  }
}

export class UnauthenticatedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'UnauthenticatedError';
  }
}
