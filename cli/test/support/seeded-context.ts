import { createServiceContext, type ServiceContext } from '@overlord/core/service/context';
import { seedServiceOperator } from '../../../packages/core/service/test-helpers.ts';
import { createSqliteClient, type DatabaseClient, openInMemoryDatabase } from '@overlord/database';

/**
 * In-memory SQLite + operator seed for CLI unit tests. Fresh migrations no longer
 * insert an implicit workspace, so callers must seed before createServiceContext.
 */
export async function createSeededCliContext({
  source = 'cli'
}: {
  source?: ServiceContext['source'];
} = {}): Promise<{ db: DatabaseClient; ctx: ServiceContext }> {
  const db = createSqliteClient(openInMemoryDatabase());
  await seedServiceOperator({ db });
  const ctx = await createServiceContext({ db, source });
  return { db, ctx };
}
