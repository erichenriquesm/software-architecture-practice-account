import type { DomainEvent } from '../../domain/events/domainEvent.js';

/** Delivers the aggregate's domain events, inside the current transaction, as integration events. */
export interface EventPublisher {
  publish(events: readonly DomainEvent[]): Promise<void>;
}
