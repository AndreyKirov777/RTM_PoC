import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ─── artifacts ───────────────────────────────────────────────

export const artifacts = pgTable(
  'artifacts',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    stableId: varchar('stable_id', { length: 20 }).notNull(),
    artifactType: varchar('artifact_type', { length: 10 }).notNull(),
    hierarchyNumber: varchar('hierarchy_number', { length: 30 }),
    title: text('title').notNull(),
    status: varchar('status', { length: 30 }),
    owner: varchar('owner', { length: 100 }),
    priority: varchar('priority', { length: 20 }),
    parentStableId: varchar('parent_stable_id', { length: 20 }),
    metadataJson: jsonb('metadata_json')
      .notNull()
      .default(sql`'{}'::jsonb`),
    bodyMarkdown: text('body_markdown').notNull().default(''),
    linksJson: jsonb('links_json')
      .notNull()
      .default(sql`'[]'::jsonb`),
    filePath: varchar('file_path', { length: 255 }).notNull(),
    sourceCommitSha: varchar('source_commit_sha', { length: 40 }).notNull(),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('artifacts_stable_id_unique').on(table.stableId),
    index('artifacts_artifact_type_idx').on(table.artifactType),
    index('artifacts_deleted_at_idx').on(table.deletedAt),
  ],
);

// ─── sync_runs ───────────────────────────────────────────────

export const syncRuns = pgTable(
  'sync_runs',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    triggerType: varchar('trigger_type', { length: 20 }).notNull(),
    commitRange: varchar('commit_range', { length: 100 }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    filesProcessed: integer('files_processed').notNull().default(0),
    filesErrored: integer('files_errored').notNull().default(0),
    artifactsCreated: integer('artifacts_created').notNull().default(0),
    artifactsUpdated: integer('artifacts_updated').notNull().default(0),
    artifactsDeleted: integer('artifacts_deleted').notNull().default(0),
    errorLog: jsonb('error_log')
      .notNull()
      .default(sql`'[]'::jsonb`),
  },
  (table) => [
    index('sync_runs_started_at_desc_idx').on(table.startedAt),
  ],
);

// ─── artifact_links (stretch) ────────────────────────────────

export const artifactLinks = pgTable(
  'artifact_links',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    sourceStableId: varchar('source_stable_id', { length: 20 }).notNull(),
    targetStableId: varchar('target_stable_id', { length: 20 }).notNull(),
    linkType: varchar('link_type', { length: 30 }).notNull(),
    sourceSection: varchar('source_section', { length: 50 }).notNull(),
  },
  (table) => [
    index('artifact_links_source_idx').on(table.sourceStableId),
    index('artifact_links_target_idx').on(table.targetStableId),
    index('artifact_links_source_target_idx').on(
      table.sourceStableId,
      table.targetStableId,
    ),
  ],
);

// ─── Inferred types ──────────────────────────────────────────

export type ArtifactRow = typeof artifacts.$inferSelect;
export type ArtifactInsert = typeof artifacts.$inferInsert;
export type SyncRunRow = typeof syncRuns.$inferSelect;
export type SyncRunInsert = typeof syncRuns.$inferInsert;
export type ArtifactLinkRow = typeof artifactLinks.$inferSelect;
export type ArtifactLinkInsert = typeof artifactLinks.$inferInsert;
