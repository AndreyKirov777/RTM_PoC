import { describe, it, expect, vi } from 'vitest';
import { DiffDetector } from './diff-detector.js';
import type { SimpleGit } from 'simple-git';

function makeGit(rawOutput: string): SimpleGit {
  return { raw: vi.fn().mockResolvedValue(rawOutput) } as unknown as SimpleGit;
}

function makeDetector(rawOutput: string): DiffDetector {
  return new DiffDetector(() => makeGit(rawOutput));
}

describe('DiffDetector – diff-based file resolution (Task 4.1)', () => {
  it('classifies A files as toUpsert', async () => {
    const detector = makeDetector('A\tdocs/02-requirements/functional/FR-001.md\n');
    const result = await detector.getChangedFiles('/repo', 'abc..def');
    expect(result.toUpsert).toHaveLength(1);
    expect(result.toUpsert[0]?.filePath).toBe('docs/02-requirements/functional/FR-001.md');
    expect(result.toUpsert[0]?.status).toBe('A');
    expect(result.toDelete).toHaveLength(0);
  });

  it('classifies M files as toUpsert', async () => {
    const detector = makeDetector('M\tdocs/03-delivery-backlog/user-stories/US-001.md\n');
    const result = await detector.getChangedFiles('/repo', 'abc..def');
    expect(result.toUpsert).toHaveLength(1);
    expect(result.toUpsert[0]?.status).toBe('M');
  });

  it('classifies D files as toDelete', async () => {
    const detector = makeDetector('D\tdocs/01-roadmap/epics/EPIC-002.md\n');
    const result = await detector.getChangedFiles('/repo', 'abc..def');
    expect(result.toDelete).toHaveLength(1);
    expect(result.toDelete[0]?.status).toBe('D');
    expect(result.toUpsert).toHaveLength(0);
  });

  it('handles mixed A, M, D output', async () => {
    const raw = [
      'A\tdocs/02-requirements/functional/FR-002.md',
      'M\tdocs/01-roadmap/epics/EPIC-001.md',
      'D\tdocs/03-delivery-backlog/user-stories/US-003.md',
    ].join('\n') + '\n';
    const detector = makeDetector(raw);
    const result = await detector.getChangedFiles('/repo', 'abc..def');
    expect(result.toUpsert).toHaveLength(2);
    expect(result.toDelete).toHaveLength(1);
  });

  it('ignores files outside tracked directories', async () => {
    const raw = [
      'A\tREADME.md',
      'M\tdocs/13-traceability/matrix.md',
      'A\tdocs/02-requirements/functional/FR-001.md',
    ].join('\n') + '\n';
    const detector = makeDetector(raw);
    const result = await detector.getChangedFiles('/repo', 'abc..def');
    expect(result.toUpsert).toHaveLength(1);
    expect(result.toUpsert[0]?.filePath).toBe('docs/02-requirements/functional/FR-001.md');
  });

  it('ignores non-markdown files', async () => {
    const detector = makeDetector('A\tdocs/02-requirements/functional/FR-001.json\n');
    const result = await detector.getChangedFiles('/repo', 'abc..def');
    expect(result.toUpsert).toHaveLength(0);
  });
});

describe('DiffDetector – full tree walk (Task 4.2)', () => {
  it('returns all markdown files in tracked directories', async () => {
    const raw = [
      'docs/01-roadmap/epics/EPIC-001.md',
      'docs/01-roadmap/epics/EPIC-002.md',
      'docs/02-requirements/functional/FR-001.md',
      'docs/13-traceability/matrix.md',
      'README.md',
    ].join('\n') + '\n';
    const detector = makeDetector(raw);
    const result = await detector.getAllArtifactFiles('/repo');
    expect(result).toHaveLength(3);
    expect(result.every(f => f.status === 'full')).toBe(true);
  });

  it('marks all entries with status full', async () => {
    const raw = 'docs/01-roadmap/epics/EPIC-001.md\n';
    const detector = makeDetector(raw);
    const result = await detector.getAllArtifactFiles('/repo');
    expect(result[0]?.status).toBe('full');
  });
});
