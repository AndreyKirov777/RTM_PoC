import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncEngine } from './sync-engine.js';
import type { SyncConfig } from '../types.js';

// ─── Helpers ─────────────────────────────────────────────────

const config: SyncConfig = {
  repoPath: '/fake/repo',
  dbConnectionString: 'postgres://localhost:5432/test',
};

// We test SyncEngine with fully mocked dependencies injected.
// The engine accepts optional dependency overrides for testability.

describe('SyncEngine – full sync pipeline (Task 7.1)', () => {
  it('returns a SyncRunResult with syncRunId', async () => {
    const engine = new SyncEngine({
      mockAllFiles: ['docs/01-roadmap/epics/EPIC-001.md'],
      mockContent: makeEpicContent('EPIC-001'),
    });
    const result = await engine.runFullSync(config);
    expect(result.syncRunId).toBeDefined();
    expect(typeof result.syncRunId).toBe('string');
  });

  it('reports correct artifact counts', async () => {
    const engine = new SyncEngine({
      mockAllFiles: [
        'docs/01-roadmap/epics/EPIC-001.md',
        'docs/02-requirements/functional/FR-001.md',
      ],
      mockContent: (p: string) =>
        p.includes('EPIC') ? makeEpicContent('EPIC-001') : makeFrContent('FR-001'),
    });
    const result = await engine.runFullSync(config);
    expect(result.filesProcessed).toBe(2);
    expect(result.filesErrored).toBe(0);
    expect(result.artifactsCreated + result.artifactsUpdated).toBe(2);
  });

  it('increments filesErrored for unparseable files', async () => {
    const engine = new SyncEngine({
      mockAllFiles: ['docs/01-roadmap/epics/EPIC-001.md'],
      mockContent: 'Not a valid artifact at all, no heading, no ID',
    });
    const result = await engine.runFullSync(config);
    expect(result.filesErrored).toBe(1);
    expect(result.filesProcessed).toBe(1);
    expect(result.errors).toHaveLength(1);
  });
});

describe('SyncEngine – diff sync pipeline (Task 7.1)', () => {
  it('handles added and modified files', async () => {
    const engine = new SyncEngine({
      mockChangedFiles: {
        toUpsert: [
          { filePath: 'docs/01-roadmap/epics/EPIC-001.md', status: 'A' as const },
        ],
        toDelete: [],
      },
      mockContent: makeEpicContent('EPIC-001'),
    });
    const result = await engine.runDiffSync(config, 'abc..def');
    expect(result.filesProcessed).toBe(1);
    expect(result.artifactsDeleted).toBe(0);
  });

  it('handles deleted files (soft-delete)', async () => {
    const engine = new SyncEngine({
      mockChangedFiles: {
        toUpsert: [],
        toDelete: [{ filePath: 'docs/01-roadmap/epics/EPIC-002.md', status: 'D' as const }],
      },
      mockContent: '',
    });
    const result = await engine.runDiffSync(config, 'abc..def');
    expect(result.artifactsDeleted).toBe(1);
  });
});

describe('SyncEngine – error isolation (Task 7.2)', () => {
  it('continues processing after a parse error', async () => {
    const engine = new SyncEngine({
      mockAllFiles: [
        'docs/01-roadmap/epics/EPIC-001.md',
        'docs/02-requirements/functional/FR-001.md',
      ],
      mockContent: (p: string) =>
        p.includes('EPIC') ? 'garbage content no H1' : makeFrContent('FR-001'),
    });
    const result = await engine.runFullSync(config);
    expect(result.filesErrored).toBe(1);
    expect(result.artifactsCreated + result.artifactsUpdated).toBe(1);
  });
});

describe('SyncEngine – validate only (Task 8.2)', () => {
  it('runs parse + validate without writing to DB', async () => {
    const engine = new SyncEngine({
      mockAllFiles: ['docs/01-roadmap/epics/EPIC-001.md'],
      mockContent: makeEpicContent('EPIC-001'),
    });
    const report = await engine.runValidateOnly(config);
    expect(report.totalFiles).toBe(1);
    expect(report.validFiles).toBe(1);
    expect(report.errors).toHaveLength(0);
  });

  it('reports validation errors without DB writes', async () => {
    const engine = new SyncEngine({
      mockAllFiles: ['docs/01-roadmap/epics/EPIC-001.md'],
      mockContent: 'no heading no id',
    });
    const report = await engine.runValidateOnly(config);
    expect(report.totalFiles).toBe(1);
    expect(report.validFiles).toBe(0);
    expect(report.errors.length).toBeGreaterThan(0);
  });
});

// ─── Content helpers ──────────────────────────────────────────

function makeEpicContent(id: string): string {
  return `# ${id} Sample Epic

## Identification

- **Stable ID**: ${id}
- **Hierarchy Number**: 1.001
- **Type**: EPIC

## Metadata

- **Status**: Draft
- **Owner**: alice

## Description

Epic description.
`;
}

function makeFrContent(id: string): string {
  return `# ${id} Sample FR

## Identification

- **Stable ID**: ${id}
- **Hierarchy Number**: 1.1.1
- **Parent**: US-001
- **Type**: FR

## Metadata

- **Status**: Draft
- **Owner**: bob
- **Priority**: High

## Description

FR description.
`;
}
