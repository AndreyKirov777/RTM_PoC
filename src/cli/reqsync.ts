#!/usr/bin/env node
import { Command } from 'commander';
import { SyncEngine } from '../sync/sync-engine.js';
import { createDb } from '../db/connection.js';
import { syncRuns } from '../db/schema.js';
import { desc } from 'drizzle-orm';
import type { SyncConfig } from '../types.js';

const program = new Command();

program
  .name('reqsync')
  .description('Sync Markdown artifact repositories to PostgreSQL')
  .version('0.1.0');

// ─── Global options ───────────────────────────────────────────

program
  .option('--repo <path>', 'Path to the git repository')
  .option('--db <url>', 'PostgreSQL connection string');

// ─── sync ─────────────────────────────────────────────────────

const syncCmd = program.command('sync').description('Run a sync operation');

syncCmd
  .command('full')
  .description('Full sync of all artifact files')
  .action(async () => {
    const config = getConfig();
    const engine = new SyncEngine();
    try {
      const result = await engine.runFullSync(config);
      printSyncResult(result);
    } catch (e) {
      console.error('Sync failed:', e);
      process.exit(1);
    }
  });

syncCmd
  .command('diff <range>')
  .description('Incremental sync for a commit range (e.g. HEAD~1 or abc..def)')
  .action(async (range: string) => {
    const config = getConfig();
    const engine = new SyncEngine();
    // Normalize HEAD~1 shorthand
    const commitRange = range === 'HEAD~1' ? 'HEAD~1..HEAD' : range;
    try {
      const result = await engine.runDiffSync(config, commitRange);
      printSyncResult(result);
    } catch (e) {
      console.error('Sync failed:', e);
      process.exit(1);
    }
  });

// ─── validate ─────────────────────────────────────────────────

program
  .command('validate')
  .description('Parse all artifacts and report validation errors without writing to the database')
  .action(async () => {
    const config = getConfig();
    const engine = new SyncEngine();
    try {
      const report = await engine.runValidateOnly(config);
      console.log(`Files: ${report.totalFiles} | Valid: ${report.validFiles} | Errors: ${report.errors.length} | Warnings: ${report.warnings.length}`);
      for (const err of report.errors) {
        console.error(`  ERROR [${err.code}] ${err.filePath}: ${err.message}`);
      }
      for (const w of report.warnings) {
        console.warn(`  WARN  [${w.code}] ${w.filePath}: ${w.message}`);
      }
      if (report.errors.length > 0) process.exit(1);
    } catch (e) {
      console.error('Validate failed:', e);
      process.exit(1);
    }
  });

// ─── status ───────────────────────────────────────────────────

program
  .command('status')
  .description('Show the last sync run summary')
  .action(async () => {
    const { db: dbUrl } = getGlobalOpts();
    if (!dbUrl) { console.error('--db is required'); process.exit(1); }
    const db = createDb(dbUrl);
    try {
      const rows = await db
        .select()
        .from(syncRuns)
        .orderBy(desc(syncRuns.startedAt))
        .limit(1);
      const last = rows[0];
      if (!last) {
        console.log('No sync runs found.');
        return;
      }
      console.log(`Last sync run: ${last.id}`);
      console.log(`  Trigger:    ${last.triggerType}`);
      console.log(`  Range:      ${last.commitRange}`);
      console.log(`  Started:    ${last.startedAt.toISOString()}`);
      console.log(`  Finished:   ${last.finishedAt?.toISOString() ?? 'N/A'}`);
      console.log(`  Processed:  ${last.filesProcessed}`);
      console.log(`  Errored:    ${last.filesErrored}`);
      console.log(`  Created:    ${last.artifactsCreated}`);
      console.log(`  Updated:    ${last.artifactsUpdated}`);
      console.log(`  Deleted:    ${last.artifactsDeleted}`);
    } catch (e) {
      console.error('Status failed:', e);
      process.exit(1);
    }
  });

// ─── Helpers ──────────────────────────────────────────────────

function getGlobalOpts(): { repo?: string; db?: string } {
  return program.opts<{ repo?: string; db?: string }>();
}

function getConfig(): SyncConfig {
  const { repo, db } = getGlobalOpts();
  if (!repo) { console.error('--repo is required'); process.exit(1); }
  if (!db) { console.error('--db is required'); process.exit(1); }
  return { repoPath: repo, dbConnectionString: db };
}

function printSyncResult(result: Awaited<ReturnType<SyncEngine['runFullSync']>>): void {
  console.log(`Sync run: ${result.syncRunId}`);
  console.log(`  Files processed: ${result.filesProcessed}`);
  console.log(`  Files errored:   ${result.filesErrored}`);
  console.log(`  Created:         ${result.artifactsCreated}`);
  console.log(`  Updated:         ${result.artifactsUpdated}`);
  console.log(`  Deleted:         ${result.artifactsDeleted}`);
  console.log(`  Duration:        ${result.duration}ms`);
  if (result.errors.length > 0) {
    console.error('Errors:');
    for (const e of result.errors) {
      console.error(`  ${e.filePath}: ${e.message}`);
    }
  }
}

program.parse();
