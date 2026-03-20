import { describe, it, expect, afterEach } from 'vitest';
import { ReqgenGenerator } from './reqgen-generator.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'reqgen-test-'));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

describe('ReqgenGenerator – core generation (Task 10.1)', () => {
  it('generates artifact files for all configured epics', async () => {
    await withTempDir(async (dir) => {
      const generator = new ReqgenGenerator();
      const result = await generator.generate({
        outputPath: dir,
        epics: 2,
        storiesPerEpic: 1,
        enablersPerEpic: 0,
        reqsPerStory: 1,
        crossCutting: 1,
        evalsPerReq: 0,
        milestones: 0,
        releases: 0,
        seed: 42,
        gitHistory: false,
        malformed: 0,
      });

      expect(result.totalFiles).toBeGreaterThan(0);
      expect(result.artifactCounts['EPIC']).toBe(2);
      expect(result.artifactCounts['US']).toBe(2); // 1 per epic
      expect(result.artifactCounts['FR']).toBe(2); // 1 per story
    });
  });

  it('creates the correct directory structure', async () => {
    await withTempDir(async (dir) => {
      const generator = new ReqgenGenerator();
      await generator.generate({
        outputPath: dir,
        epics: 1,
        storiesPerEpic: 1,
        enablersPerEpic: 0,
        reqsPerStory: 1,
        crossCutting: 0,
        evalsPerReq: 0,
        milestones: 0,
        releases: 0,
        seed: 1,
        gitHistory: false,
        malformed: 0,
      });

      const epicDir = path.join(dir, 'docs/01-roadmap/epics');
      const files = await fs.readdir(epicDir);
      expect(files.length).toBe(1);
      expect(files[0]).toBe('EPIC-001.md');
    });
  });

  it('assigns sequential stable IDs', async () => {
    await withTempDir(async (dir) => {
      const generator = new ReqgenGenerator();
      const result = await generator.generate({
        outputPath: dir,
        epics: 3,
        storiesPerEpic: 0,
        enablersPerEpic: 0,
        reqsPerStory: 0,
        crossCutting: 0,
        evalsPerReq: 0,
        milestones: 0,
        releases: 0,
        seed: 1,
        gitHistory: false,
        malformed: 0,
      });

      expect(result.artifactCounts['EPIC']).toBe(3);
      const epicDir = path.join(dir, 'docs/01-roadmap/epics');
      const files = await fs.readdir(epicDir);
      expect(files).toContain('EPIC-001.md');
      expect(files).toContain('EPIC-002.md');
      expect(files).toContain('EPIC-003.md');
    });
  });
});

describe('ReqgenGenerator – determinism (Task 8.3)', () => {
  it('produces identical output for same seed', async () => {
    const cfg = {
      epics: 2,
      storiesPerEpic: 1,
      enablersPerEpic: 0,
      reqsPerStory: 1,
      crossCutting: 1,
      evalsPerReq: 0,
      milestones: 0,
      releases: 0,
      seed: 99,
      gitHistory: false,
      malformed: 0,
    };

    await withTempDir(async (dir1) => {
      await withTempDir(async (dir2) => {
        const gen = new ReqgenGenerator();
        await gen.generate({ outputPath: dir1, ...cfg });
        await gen.generate({ outputPath: dir2, ...cfg });

        // Compare EPIC-001.md content from both runs
        const file1 = await fs.readFile(path.join(dir1, 'docs/01-roadmap/epics/EPIC-001.md'), 'utf8');
        const file2 = await fs.readFile(path.join(dir2, 'docs/01-roadmap/epics/EPIC-001.md'), 'utf8');
        expect(file1).toBe(file2);
      });
    });
  });
});

describe('ReqgenGenerator – malformed file injection (Task 8.8)', () => {
  it('injects the requested number of malformed files', async () => {
    await withTempDir(async (dir) => {
      const generator = new ReqgenGenerator();
      const result = await generator.generate({
        outputPath: dir,
        epics: 1,
        storiesPerEpic: 0,
        enablersPerEpic: 0,
        reqsPerStory: 0,
        crossCutting: 0,
        evalsPerReq: 0,
        milestones: 0,
        releases: 0,
        seed: 1,
        gitHistory: false,
        malformed: 2,
      });
      expect(result.malformedFiles).toBe(2);
    });
  });
});

describe('ReqgenGenerator – static docs (Task 8.10)', () => {
  it('generates README.md at output root', async () => {
    await withTempDir(async (dir) => {
      const generator = new ReqgenGenerator();
      await generator.generate({
        outputPath: dir,
        epics: 1,
        storiesPerEpic: 0,
        enablersPerEpic: 0,
        reqsPerStory: 0,
        crossCutting: 0,
        evalsPerReq: 0,
        milestones: 0,
        releases: 0,
        seed: 1,
        gitHistory: false,
        malformed: 0,
      });

      const readme = await fs.readFile(path.join(dir, 'README.md'), 'utf8');
      expect(readme.length).toBeGreaterThan(0);
    });
  });
});
