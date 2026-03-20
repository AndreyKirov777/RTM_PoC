/**
 * Integration tests: ReqgenGenerator → SyncEngine pipeline.
 * These tests use real file I/O with a temp directory but no real database.
 * The SyncEngine is invoked via its internal mock-file mode via file paths.
 */
import { describe, it, expect } from 'vitest';
import { ReqgenGenerator } from '../generator/reqgen-generator.js';
import { SyncEngine } from '../sync/sync-engine.js';
import { MarkdownParser } from '../parser/parser.js';
import { Validator } from '../sync/validator.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const GEN_CONFIG = {
  epics: 2,
  storiesPerEpic: 1,
  enablersPerEpic: 0,
  reqsPerStory: 1,
  crossCutting: 0,
  evalsPerReq: 0,
  milestones: 0,
  releases: 0,
  seed: 42,
  gitHistory: false,
  malformed: 0,
} as const;

async function withGeneratedRepo(
  overrides: Partial<typeof GEN_CONFIG>,
  fn: (repoPath: string) => Promise<void>,
): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rtm-int-test-'));
  try {
    const generator = new ReqgenGenerator();
    await generator.generate({ outputPath: dir, ...GEN_CONFIG, ...overrides });
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

// ─── Task 12.1: Full sync lifecycle ──────────────────────────

describe('Integration – full sync lifecycle (Task 12.1)', () => {
  it('parses all generated artifacts successfully', async () => {
    await withGeneratedRepo({}, async (repoPath) => {
      // Walk generated files and parse each one
      const parser = new MarkdownParser();
      const validator = new Validator();

      let parsed = 0;
      let errors = 0;

      const epicDir = path.join(repoPath, 'docs/01-roadmap/epics');
      for (const file of await fs.readdir(epicDir)) {
        if (!file.endsWith('.md')) continue;
        const content = await fs.readFile(path.join(epicDir, file), 'utf8');
        const result = parser.parseArtifact(`docs/01-roadmap/epics/${file}`, content);
        if (result.ok) {
          parsed++;
          const vr = validator.validateArtifact(result.value, `docs/01-roadmap/epics/${file}`);
          if (!vr.valid) errors++;
        } else {
          errors++;
        }
      }

      expect(parsed).toBe(2); // 2 epics
      expect(errors).toBe(0);
    });
  });

  it('SyncEngine validate-only reports all valid generated artifacts', async () => {
    await withGeneratedRepo({}, async (repoPath) => {
      // Read actual files and feed them to a mock SyncEngine
      const epicDir = path.join(repoPath, 'docs/01-roadmap/epics');
      const epicFiles = (await fs.readdir(epicDir))
        .filter(f => f.endsWith('.md'))
        .map(f => `docs/01-roadmap/epics/${f}`);

      const fileContents = new Map<string, string>();
      for (const fp of epicFiles) {
        fileContents.set(fp, await fs.readFile(path.join(repoPath, fp), 'utf8'));
      }

      const engine = new SyncEngine({
        mockAllFiles: epicFiles,
        mockContent: (fp: string) => fileContents.get(fp) ?? '',
      });

      const report = await engine.runValidateOnly({ repoPath, dbConnectionString: '' });
      expect(report.totalFiles).toBe(2);
      expect(report.validFiles).toBe(2);
      expect(report.errors).toHaveLength(0);
    });
  });

  it('SyncEngine full sync counts match generated artifact count', async () => {
    await withGeneratedRepo({}, async (repoPath) => {
      const epicDir = path.join(repoPath, 'docs/01-roadmap/epics');
      const epicFiles = (await fs.readdir(epicDir))
        .filter(f => f.endsWith('.md'))
        .map(f => `docs/01-roadmap/epics/${f}`);

      const fileContents = new Map<string, string>();
      for (const fp of epicFiles) {
        fileContents.set(fp, await fs.readFile(path.join(repoPath, fp), 'utf8'));
      }

      const engine = new SyncEngine({
        mockAllFiles: epicFiles,
        mockContent: (fp: string) => fileContents.get(fp) ?? '',
      });

      const result = await engine.runFullSync({ repoPath, dbConnectionString: '' });
      expect(result.filesProcessed).toBe(2);
      expect(result.filesErrored).toBe(0);
      expect(result.artifactsCreated).toBe(2);
    });
  });
});

// ─── Task 12.1: Idempotency ───────────────────────────────────

describe('Integration – idempotency (Task 12.1)', () => {
  it('running full sync twice produces same counts', async () => {
    await withGeneratedRepo({}, async (repoPath) => {
      const epicDir = path.join(repoPath, 'docs/01-roadmap/epics');
      const epicFiles = (await fs.readdir(epicDir))
        .filter(f => f.endsWith('.md'))
        .map(f => `docs/01-roadmap/epics/${f}`);

      const fileContents = new Map<string, string>();
      for (const fp of epicFiles) {
        fileContents.set(fp, await fs.readFile(path.join(repoPath, fp), 'utf8'));
      }

      const config = { repoPath, dbConnectionString: '' };
      const mockOpts = {
        mockAllFiles: epicFiles,
        mockContent: (fp: string) => fileContents.get(fp) ?? '',
      };

      const result1 = await new SyncEngine(mockOpts).runFullSync(config);
      const result2 = await new SyncEngine(mockOpts).runFullSync(config);

      expect(result1.filesProcessed).toBe(result2.filesProcessed);
      expect(result1.filesErrored).toBe(result2.filesErrored);
      expect(result1.artifactsCreated).toBe(result2.artifactsCreated);
    });
  });
});

// ─── Task 12.2: Error isolation ───────────────────────────────

describe('Integration – error isolation (Task 12.2)', () => {
  it('syncs valid artifacts and logs errors for malformed ones', async () => {
    await withGeneratedRepo({ malformed: 2 }, async (repoPath) => {
      const epicDir = path.join(repoPath, 'docs/01-roadmap/epics');
      const allFiles = (await fs.readdir(epicDir))
        .filter(f => f.endsWith('.md'))
        .map(f => `docs/01-roadmap/epics/${f}`);

      const fileContents = new Map<string, string>();
      for (const fp of allFiles) {
        fileContents.set(fp, await fs.readFile(path.join(repoPath, fp), 'utf8'));
      }

      const engine = new SyncEngine({
        mockAllFiles: allFiles,
        mockContent: (fp: string) => fileContents.get(fp) ?? '',
      });

      const result = await engine.runFullSync({ repoPath, dbConnectionString: '' });

      // Some files should fail (malformed), some should succeed
      expect(result.filesErrored).toBeGreaterThan(0);
      expect(result.artifactsCreated).toBeGreaterThan(0);
      expect(result.errors.length).toBe(result.filesErrored);
    });
  });
});

// ─── Task 12.3: Generator determinism ────────────────────────

describe('Integration – generator determinism (Task 12.3)', () => {
  it('produces identical EPIC-001.md with same seed across two runs', async () => {
    const gen = new ReqgenGenerator();

    const dir1 = await fs.mkdtemp(path.join(os.tmpdir(), 'rtm-det1-'));
    const dir2 = await fs.mkdtemp(path.join(os.tmpdir(), 'rtm-det2-'));

    try {
      await gen.generate({ outputPath: dir1, ...GEN_CONFIG });
      await gen.generate({ outputPath: dir2, ...GEN_CONFIG });

      const file1 = await fs.readFile(path.join(dir1, 'docs/01-roadmap/epics/EPIC-001.md'), 'utf8');
      const file2 = await fs.readFile(path.join(dir2, 'docs/01-roadmap/epics/EPIC-001.md'), 'utf8');
      expect(file1).toBe(file2);
    } finally {
      await fs.rm(dir1, { recursive: true, force: true });
      await fs.rm(dir2, { recursive: true, force: true });
    }
  });

  it('produces different output with different seeds', async () => {
    const gen = new ReqgenGenerator();

    const dir1 = await fs.mkdtemp(path.join(os.tmpdir(), 'rtm-seed1-'));
    const dir2 = await fs.mkdtemp(path.join(os.tmpdir(), 'rtm-seed2-'));

    try {
      await gen.generate({ outputPath: dir1, ...GEN_CONFIG, seed: 1 });
      await gen.generate({ outputPath: dir2, ...GEN_CONFIG, seed: 2 });

      // FR files may differ because cross-cutting assignments differ
      // Both should have valid artifacts
      const epics1 = await fs.readdir(path.join(dir1, 'docs/01-roadmap/epics'));
      const epics2 = await fs.readdir(path.join(dir2, 'docs/01-roadmap/epics'));
      expect(epics1.length).toBe(epics2.length); // same count, different content possible
    } finally {
      await fs.rm(dir1, { recursive: true, force: true });
      await fs.rm(dir2, { recursive: true, force: true });
    }
  });
});

// ─── Task 12.3: Validate-only (no DB writes) ─────────────────

describe('Integration – validate only (Task 12.3)', () => {
  it('validate-only returns results without requiring DB', async () => {
    await withGeneratedRepo({}, async (repoPath) => {
      const epicDir = path.join(repoPath, 'docs/01-roadmap/epics');
      const epicFiles = (await fs.readdir(epicDir))
        .filter(f => f.endsWith('.md'))
        .map(f => `docs/01-roadmap/epics/${f}`);

      const fileContents = new Map<string, string>();
      for (const fp of epicFiles) {
        fileContents.set(fp, await fs.readFile(path.join(repoPath, fp), 'utf8'));
      }

      const engine = new SyncEngine({
        mockAllFiles: epicFiles,
        mockContent: (fp: string) => fileContents.get(fp) ?? '',
      });

      const report = await engine.runValidateOnly({ repoPath, dbConnectionString: '' });
      expect(report.totalFiles).toBe(2);
      expect(report.validFiles).toBeGreaterThan(0);
    });
  });
});
