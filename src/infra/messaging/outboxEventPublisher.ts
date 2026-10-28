import type { EventPublisher } from '../../application/contracts/eventPublisher.js';
import type { AccountCreated } from '../../domain/events/accountCreated.js';
import type { DomainEvent } from '../../domain/events/domainEvent.js';
import type { Database } from '../database/database.js';
import type { KyselyTransactionRunner } from '../database/kyselyTransactionRunner.js';
import { createEnvelope } from '../platform/messaging/envelope.js';
import type { OutboxMessage } from '../platform/messaging/outbox.js';
import { appendToOutbox } from '../platform/messaging/outbox.js';
import type { SchemaValidator } from '../platform/messaging/schemas.js';
import { loadSchemaValidator } from '../platform/messaging/schemas.js';
import { currentCorrelation } from '../platform/observability/correlation.js';

export const accountEventsExchange = 'account.events';

export interface AccountCreatedPayload {
  readonly accountId: string;
}

/** Maps each domain event to its integration event and appends it to the outbox in the current transaction. */
export class OutboxEventPublisher implements EventPublisher {
  constructor(
    private readonly runner: KyselyTransactionRunner<Database>,
    private readonly validateAccountCreated: SchemaValidator<AccountCreatedPayload> = loadSchemaValidator(
      'src/infra/schemas/published/events/account.created.v1.schema.json',
    ),
  ) {}

  async publish(events: readonly DomainEvent[]): Promise<void> {
    for (const event of events) await appendToOutbox(this.runner.transaction(), this.toMessage(event));
  }

  private toMessage(event: DomainEvent): OutboxMessage {
    switch (event.type) {
      case 'AccountCreated':
        return this.accountCreated(event as AccountCreated);
      default:
        throw new Error(`No integration event for domain event ${event.type}`);
    }
  }

  private accountCreated(event: AccountCreated): OutboxMessage {
    const payload = this.validateAccountCreated({ accountId: event.accountId });
    const correlation = currentCorrelation();
    const envelope = createEnvelope(
      { type: 'account.created', version: 1, producer: 'account', correlationId: correlation.correlationId, causationId: correlation.causationId, payload },
      () => event.occurredAt,
    );
    return { routingKey: 'account.created', envelope };
  }
}
