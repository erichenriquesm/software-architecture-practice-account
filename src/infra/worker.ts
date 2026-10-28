import Fastify from 'fastify';
import { buildAccountCore, serviceName } from './composition.js';
import { createDatabase, PostgresProbe } from './database/postgres.js';
import { registerHealthRoutes } from './http/health.js';
import { accountEventsExchange } from './messaging/outboxEventPublisher.js';
import { classifyWalletBalancesFailure, walletBalancesHandler, walletBalancesQueue } from './messaging/walletBalancesConsumer.js';
import { connectRabbitMq, rabbitMqUrlFromEnv } from './platform/messaging/connection.js';
import { Consumer } from './platform/messaging/consumer.js';
import { loadEnvelopeValidator } from './platform/messaging/envelope.js';
import { OutboxRelay } from './platform/messaging/outbox.js';
import { declareConsumerQueue } from './platform/messaging/topology.js';
import { healthPortSetting, postgresSettings } from './settings.js';

const outboxLockKey = 7_001;

const db = createDatabase(postgresSettings());
const core = buildAccountCore(db);
const log = Fastify({ logger: true }).log;
let brokerUp = false;

const healthServer = Fastify({ logger: false });
registerHealthRoutes(healthServer, serviceName, [
  new PostgresProbe(db),
  { dependency: 'rabbitmq', isHealthy: async () => brokerUp },
]);
await healthServer.listen({ host: '0.0.0.0', port: healthPortSetting() });

/*
 * One connection for the life of the process. If it drops, the worker exits and the container restarts
 * (restart: unless-stopped); the outbox and the inbox make the restart lossless.
 */
const connection = await connectRabbitMq(rabbitMqUrlFromEnv());
const relay = new OutboxRelay(db, await connection.createConfirmChannel(), { exchange: accountEventsExchange, lockKey: outboxLockKey });
const channel = await connection.createChannel();
for (const binding of walletBalancesQueue.bindings) await channel.checkExchange(binding.exchange);
await declareConsumerQueue(channel, walletBalancesQueue);
const consumer = new Consumer(core.runner, channel, {
  definition: walletBalancesQueue,
  handler: walletBalancesHandler(core.projectWalletBalance),
  validate: loadEnvelopeValidator(),
  classify: classifyWalletBalancesFailure,
});
relay.start();
await consumer.start();
brokerUp = true;

const cleanup = async (): Promise<void> => {
  relay.stop();
  await consumer.stop().catch(() => undefined);
  await connection.close().catch(() => undefined);
  await healthServer.close();
  await db.destroy();
};

const exitOnBrokerLoss = (error?: unknown): void => {
  if (!brokerUp) return;
  brokerUp = false;
  log.error({ err: error }, 'rabbitmq connection lost, exiting so the container restarts');
  // Exit at once: closing channels on a dead connection can hang, and the outbox + inbox make a hard exit safe.
  process.exit(1);
};
connection.on('error', exitOnBrokerLoss);
connection.on('close', exitOnBrokerLoss);

const shutdown = async (): Promise<void> => {
  brokerUp = false;
  await cleanup();
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
