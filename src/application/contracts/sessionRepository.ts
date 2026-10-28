import type { Session } from '../../domain/entities/session.js';

export interface SessionRepository {
  save(session: Session): Promise<void>;
  revoke(tokenHash: string, now: Date): Promise<void>;
}
