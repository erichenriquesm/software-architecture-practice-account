export interface LoginThrottle {
  /** Seconds until this email or IP may try again; undefined when it may try now. */
  blockedFor(email: string, ip: string): Promise<number | undefined>;
  recordFailure(email: string, ip: string): Promise<void>;
  reset(email: string): Promise<void>;
}
