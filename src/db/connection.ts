import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Database = ReturnType<typeof createDb>;

export function createDb(connectionString: string): ReturnType<typeof drizzle<typeof schema>> {
  const pool = new pg.Pool({ connectionString });
  return drizzle(pool, { schema });
}

export type DrizzleTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];
