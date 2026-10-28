import type { Kysely } from 'kysely';
import type { Migration } from '../migrator.js';

export default class implements Migration {
  async up(db: Kysely<unknown>): Promise<void> {
    await db.schema
      .createTable('session')
      .addColumn('session_id', 'uuid', (column) => column.primaryKey())
      .addColumn('account_id', 'uuid', (column) => column.notNull().references('account.account_id'))
      .addColumn('token_hash', 'text', (column) => column.notNull().unique())
      .addColumn('created_at', 'timestamptz', (column) => column.notNull())
      .addColumn('expires_at', 'timestamptz', (column) => column.notNull())
      .addColumn('revoked_at', 'timestamptz')
      .execute();
    await db.schema.createIndex('session_account_idx').on('session').column('account_id').execute();
  }

  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.dropTable('session').execute();
  }
}
