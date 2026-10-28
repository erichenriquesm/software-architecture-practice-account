import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { TestDatabase } from '../../../support/database.js';
import { createTestDatabase } from '../../../support/database.js';
import type { AccountCreated } from '../../../../src/domain/events/accountCreated.js';
import type { Database } from '../../../../src/infra/database/database.js';
import { KyselyTransactionRunner } from '../../../../src/infra/database/kyselyTransactionRunner.js';
import { OutboxEventPublisher } from '../../../../src/infra/messaging/outboxEventPublisher.js';

let database: TestDatabase;
let runner: KyselyTransactionRunner<Database>;
let eventPublisher: OutboxEventPublisher;

beforeAll(async () => {
  database = await createTestDatabase();
  runner = new KyselyTransactionRunner(database.db);
  eventPublisher = new OutboxEventPublisher(runner);
});

afterAll(() => database.destroy());

const accountCreated: AccountCreated = { type: 'AccountCreated', accountId: '0199d5f4-2b9a-7c3e-9a51-2f1d3c4b5a69', occurredAt: new Date() };

const writeAndPublish = (key: string, fail: boolean) =>
  runner.run(async () => {
    await runner.executor().insertInto('inbox').values({ consumer: 'repository', message_key: key }).execute();
    await eventPublisher.publish([accountCreated]);
    if (fail) throw new Error('use case failed after publish');
  });

const written = async () => ({
  inbox: (await database.db.selectFrom('inbox').select('message_key').execute()).map((row) => row.message_key),
  outbox: (await database.db.selectFrom('outbox').select('routing_key').execute()).map((row) => row.routing_key),
});

describe('KyselyTransactionRunner with the outbox event publisher', () => {
  test('Should roll back the repository write and the outbox write together when the use case fails', async () => {
    // When
    await expect(writeAndPublish('failed', true)).rejects.toThrowError('use case failed after publish');

    // Then
    expect(await written()).toEqual({ inbox: [], outbox: [] });
  });

  test('Should commit both writes in one transaction when the use case succeeds', async () => {
    // When
    await writeAndPublish('committed', false);

    // Then
    expect(await written()).toEqual({ inbox: ['committed'], outbox: ['account.created'] });
  });

  test('Should refuse a domain event without an integration event mapping', async () => {
    // When & Then
    await expect(runner.run(() => eventPublisher.publish([{ type: 'Unknown', occurredAt: new Date() }]))).rejects.toThrowError(
      'No integration event for domain event Unknown',
    );
  });
});
