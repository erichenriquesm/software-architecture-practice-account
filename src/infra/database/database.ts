import type { ColumnType, Generated } from 'kysely';

export interface Database {
  account: AccountTable;
  account_balance_view: AccountBalanceViewTable;
  session: SessionTable;
  outbox: OutboxTable;
  inbox: InboxTable;
}

export interface OutboxTable {
  id: Generated<string>;
  event_id: string;
  type: string;
  routing_key: string;
  envelope: ColumnType<unknown, string, string>;
  created_at: Generated<Date>;
  published_at: Date | null;
}

export interface InboxTable {
  consumer: string;
  message_key: string;
  processed_at: Generated<Date>;
}

export interface AccountTable {
  account_id: string;
  name: string;
  email: string;
  document: string;
  password_hash: string;
  created_at: Generated<Date>;
}

export interface AccountBalanceViewTable {
  account_id: string;
  asset_id: string;
  available: ColumnType<string, string, string>;
  reserved: ColumnType<string, string, string>;
  version: ColumnType<string, number, number>;
  updated_at: Date;
}

export interface SessionTable {
  session_id: string;
  account_id: string;
  token_hash: string;
  created_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
}
