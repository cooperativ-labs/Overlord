/**
 * `@overlord/database` — the persistence package for Overlord.
 *
 * Owns the SQLite migrations, the local-development launcher, the connection /
 * migration runtime, the database-layer constants and controlled vocabularies,
 * and the single `resolveAdapter()` adapter-selection point. The CLI, the root
 * service layer, and the auth module all depend on this package instead of
 * reaching across folder boundaries with relative imports.
 */
export { type AdapterConfig, resolveAdapter } from './adapter.js';
export { loadBetterSqlite3 } from './better-sqlite3-loader.js';
export {
  bindBool,
  createPostgresClient,
  createPostgresSessionClient,
  createSqliteClient,
  type DatabaseClient,
  openDatabaseClient,
  type RunResult,
  type SqlDialect,
  toPostgresPlaceholders,
  TransactionClosedError
} from './client.js';
export {
  fixupLocalStoragePaths,
  listSqliteMigrationFiles,
  migrateDatabase,
  openDatabase,
  openInMemoryDatabase,
  type OverlordDatabase,
  resolveDefaultDatabasePath
} from './connection.js';
export {
  DEFAULT_STATUSES,
  OBJECTIVE_STATES,
  type ObjectiveState,
  SCHEMA_CONTRACT_VERSION,
  UPDATE_EVENT_TYPES,
  UPDATE_PHASES
} from './constants.js';
export {
  GLOBAL_DATA_DIR_NAME,
  GLOBAL_DATABASE_FILENAME,
  LOCAL_DATA_DIR,
  LOCAL_STORAGE_DIR,
  resolveGlobalDatabasePath,
  resolveGlobalDataDir
} from './local-paths.js';
export { listPostgresMigrationFiles, migratePostgres } from './migrate-postgres.js';
export {
  COPY_HUMAN_ACTION_RESOLUTIONS_SQL,
  type DerivedMissionItem,
  deriveMissionItems,
  INSERT_MISSION_ITEM_SQL,
  insertMissionItemParams,
  insertMissionItemsSql,
  MISSION_ITEM_CLOSED_STATUSES,
  MISSION_ITEM_KINDS,
  MISSION_ITEM_OUTCOMES,
  MISSION_ITEM_RESOLVER_KINDS,
  MISSION_ITEM_STATUS_REASON_MAX_LENGTH,
  MISSION_ITEM_STATUSES,
  type MissionItemClosedStatus,
  type MissionItemDeliveryScope,
  type MissionItemKind,
  type MissionItemOutcome,
  missionItemRef,
  type MissionItemResolverKind,
  type MissionItemStatus,
  normaliseMissionItemText,
  REOPENED_ITEM_PREDICATE_SQL,
  REPLACED_HUMAN_ACTION_PREDICATE_SQL,
  SUPERSEDED_ITEM_PREDICATE_SQL,
  supersedeMissionItemsSql
} from './mission-items.js';
export {
  finalizeMissionItemsPostgres,
  finalizeMissionItemsSqlite,
  isMissionItemsMigration,
  MISSION_ITEMS_BACKFILL_BATCH_SIZE,
  MISSION_ITEMS_MIGRATION_VERSION
} from './mission-items-migration-runtime.js';
export {
  formatObjectiveDisplayId,
  generateObjectiveDisplayKey,
  missionDisplayIdFromObjectiveRef,
  OBJECTIVE_DISPLAY_ID_SEPARATOR,
  OBJECTIVE_DISPLAY_KEY_ALPHABET,
  OBJECTIVE_DISPLAY_KEY_LENGTH,
  type ParsedObjectiveRef,
  parseObjectiveRef
} from './objective-display-key.js';
export {
  applyHostedS3StorageBackend,
  type HostedS3SeedResult,
  resolveHostedS3SettingsFromEnv,
  type S3BucketSettings
} from './storage-seed.js';
