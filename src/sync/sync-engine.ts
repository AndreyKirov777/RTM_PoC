import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createDb } from '../db/connection.js';
import { artifacts as artifactsTable, syncRuns } from '../db/schema.js';
import {
  type SyncConfig,
  type SyncRunResult,
  type ValidationReport,
  type ValidationError,
  type DiffResult,
  type FileEntry,
  ARTIFACT_TYPE_ORDER,
  type ArtifactType,
} from '../types.js';
import { DiffDetector } from './diff-detector.js';
import { MarkdownParser } from '../parser/parser.js';
import { Validator } from './validator.js';
import { UpsertWriter } from './upsert-writer.js';
import { eq } from 'drizzle-orm';

// ─── Test injection types ─────────────────────────────────────

interface SyncEngineMockOptions {
  mockAllFiles?: string[];
  mockContent?: string | ((filePath: string) => string);
  mockChangedFiles?: DiffResult;
}

// ─── SyncEngine ───────────────────────────────────────────────

export class SyncEngine {
  private readonly parser = new MarkdownParser();
  private readonly validator = new Validator();
  private readonly writer = new UpsertWriter();
  private readonly diffDetector = new DiffDetector();
  private readonly mockOptions: SyncEngineMockOptions | undefined;

  constructor(mockOptions?: SyncEngineMockOptions) {
    this.mockOptions = mockOptions;
  }

  // ─── Public API ───────────────────────────────────────────

  async runFullSync(config: SyncConfig): Promise<SyncRunResult> {
    const startedAt = Date.now();
    const syncRunId = randomUUID();
    const errors: Array<{ filePath: string; message: string }> = [];

    let filesProcessed = 0;
    let filesErrored = 0;
    let artifactsCreated = 0;
    let artifactsUpdated = 0;

    const files = await this.getAllFiles(config.repoPath);
    const sorted = this.sortByDependencyOrder(files);

    if (this.mockOptions) {
      // In test mode: parse + validate without real DB
      for (const entry of sorted) {
        const content = this.getContent(entry.filePath);
        filesProcessed++;
        const parseResult = this.parser.parseArtifact(entry.filePath, content);
        if (!parseResult.ok) {
          filesErrored++;
          errors.push({ filePath: entry.filePath, message: parseResult.error.message });
          continue;
        }
        const validation = this.validator.validateArtifact(parseResult.value, entry.filePath);
        if (!validation.valid) {
          filesErrored++;
          errors.push({ filePath: entry.filePath, message: validation.errors[0]?.message ?? 'Validation failed' });
          continue;
        }
        artifactsCreated++;
      }
    } else {
      const db = createDb(config.dbConnectionString);
      await db.transaction(async (tx) => {
        for (const entry of sorted) {
          const fullPath = path.join(config.repoPath, entry.filePath);
          let content: string;
          try {
            content = await fs.readFile(fullPath, 'utf8');
          } catch {
            filesProcessed++;
            filesErrored++;
            errors.push({ filePath: entry.filePath, message: 'Could not read file' });
            continue;
          }

          filesProcessed++;
          const parseResult = this.parser.parseArtifact(entry.filePath, content);
          if (!parseResult.ok) {
            filesErrored++;
            errors.push({ filePath: entry.filePath, message: parseResult.error.message });
            continue;
          }

          const validation = this.validator.validateArtifact(parseResult.value, entry.filePath);
          if (!validation.valid) {
            filesErrored++;
            errors.push({ filePath: entry.filePath, message: validation.errors[0]?.message ?? 'Validation failed' });
            continue;
          }

          try {
            const upsertResult = await this.writer.upsertArtifact(
              tx,
              parseResult.value,
              'full',
              entry.filePath,
            );
            if (upsertResult.action === 'created') artifactsCreated++;
            else artifactsUpdated++;
          } catch (e) {
            filesErrored++;
            errors.push({ filePath: entry.filePath, message: String(e) });
          }
        }

        // Record sync run
        await tx.insert(syncRuns).values({
          id: syncRunId,
          triggerType: 'cli_full',
          commitRange: 'full',
          startedAt: new Date(startedAt),
          finishedAt: new Date(),
          filesProcessed,
          filesErrored,
          artifactsCreated,
          artifactsUpdated,
          artifactsDeleted: 0,
          errorLog: errors,
        });
      });
    }

    return {
      syncRunId,
      triggerType: 'cli_full',
      commitRange: 'full',
      filesProcessed,
      filesErrored,
      artifactsCreated,
      artifactsUpdated,
      artifactsDeleted: 0,
      errors,
      duration: Date.now() - startedAt,
    };
  }

  async runDiffSync(config: SyncConfig, commitRange: string): Promise<SyncRunResult> {
    const startedAt = Date.now();
    const syncRunId = randomUUID();
    const errors: Array<{ filePath: string; message: string }> = [];

    let filesProcessed = 0;
    let filesErrored = 0;
    let artifactsCreated = 0;
    let artifactsUpdated = 0;
    let artifactsDeleted = 0;

    const diff = await this.getDiff(config.repoPath, commitRange);
    const sorted = this.sortByDependencyOrder(diff.toUpsert);

    if (this.mockOptions) {
      for (const entry of sorted) {
        const content = this.getContent(entry.filePath);
        filesProcessed++;
        const parseResult = this.parser.parseArtifact(entry.filePath, content);
        if (!parseResult.ok) {
          filesErrored++;
          errors.push({ filePath: entry.filePath, message: parseResult.error.message });
          continue;
        }
        artifactsCreated++;
      }
      artifactsDeleted = diff.toDelete.length;
    } else {
      const db = createDb(config.dbConnectionString);
      await db.transaction(async (tx) => {
        for (const entry of sorted) {
          const fullPath = path.join(config.repoPath, entry.filePath);
          let content: string;
          try {
            content = await fs.readFile(fullPath, 'utf8');
          } catch {
            filesProcessed++;
            filesErrored++;
            errors.push({ filePath: entry.filePath, message: 'Could not read file' });
            continue;
          }

          filesProcessed++;
          const parseResult = this.parser.parseArtifact(entry.filePath, content);
          if (!parseResult.ok) {
            filesErrored++;
            errors.push({ filePath: entry.filePath, message: parseResult.error.message });
            continue;
          }

          const validation = this.validator.validateArtifact(parseResult.value, entry.filePath);
          if (!validation.valid) {
            filesErrored++;
            errors.push({ filePath: entry.filePath, message: validation.errors[0]?.message ?? 'Validation failed' });
            continue;
          }

          try {
            const upsertResult = await this.writer.upsertArtifact(
              tx,
              parseResult.value,
              commitRange,
              entry.filePath,
            );
            if (upsertResult.action === 'created') artifactsCreated++;
            else artifactsUpdated++;
          } catch (e) {
            filesErrored++;
            errors.push({ filePath: entry.filePath, message: String(e) });
          }
        }

        // Soft-delete
        const toDeleteIds = diff.toDelete.map(f => path.basename(f.filePath, '.md'));
        if (toDeleteIds.length > 0) {
          artifactsDeleted = await this.writer.softDeleteArtifacts(tx, toDeleteIds, commitRange);
        }

        await tx.insert(syncRuns).values({
          id: syncRunId,
          triggerType: 'cli_diff',
          commitRange,
          startedAt: new Date(startedAt),
          finishedAt: new Date(),
          filesProcessed,
          filesErrored,
          artifactsCreated,
          artifactsUpdated,
          artifactsDeleted,
          errorLog: errors,
        });
      });
    }

    return {
      syncRunId,
      triggerType: 'cli_diff',
      commitRange,
      filesProcessed,
      filesErrored,
      artifactsCreated,
      artifactsUpdated,
      artifactsDeleted,
      errors,
      duration: Date.now() - startedAt,
    };
  }

  async runValidateOnly(config: SyncConfig): Promise<ValidationReport> {
    const files = await this.getAllFiles(config.repoPath);
    const sorted = this.sortByDependencyOrder(files);
    const errors: ValidationError[] = [];
    let validFiles = 0;

    for (const entry of sorted) {
      const content = this.getContent(entry.filePath);
      const parseResult = this.parser.parseArtifact(entry.filePath, content);
      if (!parseResult.ok) {
        errors.push({
          filePath: entry.filePath,
          field: 'parse',
          message: parseResult.error.message,
          code: 'MISSING_REQUIRED_FIELD',
        });
        continue;
      }
      const validation = this.validator.validateArtifact(parseResult.value, entry.filePath);
      if (validation.valid) {
        validFiles++;
      } else {
        errors.push(...validation.errors);
      }
    }

    return {
      totalFiles: sorted.length,
      validFiles,
      errors,
      warnings: [],
    };
  }

  // ─── Private helpers ──────────────────────────────────────

  private async getAllFiles(repoPath: string): Promise<FileEntry[]> {
    if (this.mockOptions?.mockAllFiles) {
      return this.mockOptions.mockAllFiles.map(fp => ({ filePath: fp, status: 'full' as const }));
    }
    return this.diffDetector.getAllArtifactFiles(repoPath);
  }

  private async getDiff(repoPath: string, commitRange: string): Promise<DiffResult> {
    if (this.mockOptions?.mockChangedFiles) {
      return this.mockOptions.mockChangedFiles;
    }
    return this.diffDetector.getChangedFiles(repoPath, commitRange);
  }

  private getContent(filePath: string): string {
    if (this.mockOptions?.mockContent) {
      return typeof this.mockOptions.mockContent === 'function'
        ? this.mockOptions.mockContent(filePath)
        : this.mockOptions.mockContent;
    }
    return '';
  }

  /**
   * Sort files by artifact type dependency order so parents are processed before children.
   */
  private sortByDependencyOrder(files: FileEntry[]): FileEntry[] {
    const typeIndex = new Map<ArtifactType, number>(
      ARTIFACT_TYPE_ORDER.map((t, i) => [t, i]),
    );

    return [...files].sort((a, b) => {
      const aPrefix = path.basename(a.filePath, '.md').split('-')[0] ?? '';
      const bPrefix = path.basename(b.filePath, '.md').split('-')[0] ?? '';
      const aIdx = typeIndex.get(aPrefix as ArtifactType) ?? 999;
      const bIdx = typeIndex.get(bPrefix as ArtifactType) ?? 999;
      return aIdx - bIdx;
    });
  }
}
