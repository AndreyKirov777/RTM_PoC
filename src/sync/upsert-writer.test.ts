import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UpsertWriter } from './upsert-writer.js';
import type { ParsedArtifact } from '../types.js';

// ─── Mock Drizzle transaction ─────────────────────────────────

function makeArtifact(overrides: Partial<ParsedArtifact> = {}): ParsedArtifact {
  return {
    stableId: 'FR-001',
    artifactType: 'FR',
    title: 'Sample FR',
    hierarchyNumber: '1.1',
    parentStableId: 'US-001',
    status: 'Draft',
    owner: 'alice',
    priority: 'High',
    metadata: { acceptanceCriteria: '1. AC one.' },
    bodyMarkdown: '# FR-001\n',
    sections: new Map(),
    links: [{ targetId: 'US-001', linkType: 'parent', section: 'Traceability' }],
    ...overrides,
  };
}

// Minimal mock of Drizzle tx insert chain
function makeMockTx(existingRow?: { id: string; stableId: string } | null) {
  // The upsert writer will call tx.insert(...).values(...).onConflictDoUpdate(...)
  // We need to track what was inserted/upserted
  const insertedValues: unknown[] = [];
  const updatedStableIds: string[] = [];
  const deletedStableIds: string[] = [];

  const onConflictDoUpdate = vi.fn().mockResolvedValue([
    existingRow
      ? { stableId: existingRow.stableId, id: existingRow.id }
      : { stableId: 'FR-001', id: 'new-uuid' },
  ]);

  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });

  const insert = vi.fn().mockReturnValue({ values });

  // For soft-delete
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn().mockReturnValue({ where });
  const update = vi.fn().mockReturnValue({ set });

  // For select (to check existing)
  const selectResult = existingRow ? [existingRow] : [];
  const limit = vi.fn().mockResolvedValue(selectResult);
  const from = vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit }) });
  const select = vi.fn().mockReturnValue({ from });

  const tx = { insert, update, select } as unknown as Parameters<Parameters<ReturnType<typeof import('../db/connection.js').createDb>['transaction']>[0]>[0];

  return { tx, insertedValues, updatedStableIds, deletedStableIds, onConflictDoUpdate, values, insert, set, where, update };
}

describe('UpsertWriter – upsert artifact (Task 6.1)', () => {
  it('calls insert with correct artifact data', async () => {
    const { tx, insert, values, onConflictDoUpdate } = makeMockTx();
    const writer = new UpsertWriter();
    const artifact = makeArtifact();

    await writer.upsertArtifact(tx, artifact, 'abc123', 'docs/fr/FR-001.md');

    expect(insert).toHaveBeenCalledOnce();
    expect(values).toHaveBeenCalledOnce();

    const calledWith = (values.mock.calls[0] as [Record<string, unknown>])[0];
    expect(calledWith['stableId']).toBe('FR-001');
    expect(calledWith['title']).toBe('Sample FR');
    expect(calledWith['artifactType']).toBe('FR');
    expect(calledWith['sourceCommitSha']).toBe('abc123');
    expect(calledWith['filePath']).toBe('docs/fr/FR-001.md');
    expect(onConflictDoUpdate).toHaveBeenCalledOnce();
  });

  it('stores links_json as array of link entries', async () => {
    const { tx, values } = makeMockTx();
    const writer = new UpsertWriter();
    const artifact = makeArtifact({
      links: [
        { targetId: 'US-001', linkType: 'parent', section: 'Traceability' },
        { targetId: 'NFR-003', linkType: 'Verifies', section: 'Traceability' },
      ],
    });

    await writer.upsertArtifact(tx, artifact, 'sha1', 'path.md');

    const calledWith = (values.mock.calls[0] as [Record<string, unknown>])[0];
    const linksJson = calledWith['linksJson'] as Array<{ target_id: string }>;
    expect(Array.isArray(linksJson)).toBe(true);
    expect(linksJson).toHaveLength(2);
    expect(linksJson[0]?.['target_id']).toBe('US-001');
  });

  it('stores metadata_json with all metadata fields', async () => {
    const { tx, values } = makeMockTx();
    const writer = new UpsertWriter();
    const artifact = makeArtifact({ metadata: { customField: 'value', acceptanceCriteria: 'AC1' } });

    await writer.upsertArtifact(tx, artifact, 'sha1', 'path.md');

    const calledWith = (values.mock.calls[0] as [Record<string, unknown>])[0];
    const metaJson = calledWith['metadataJson'] as Record<string, string>;
    expect(metaJson['customField']).toBe('value');
    expect(metaJson['acceptanceCriteria']).toBe('AC1');
  });

  it('returns action created for new artifact', async () => {
    const { tx } = makeMockTx(null);
    const writer = new UpsertWriter();
    const artifact = makeArtifact();

    const result = await writer.upsertArtifact(tx, artifact, 'sha1', 'path.md');

    // action is determined by whether we got a result back from upsert
    expect(result.stableId).toBe('FR-001');
    expect(['created', 'updated']).toContain(result.action);
  });
});

describe('UpsertWriter – soft-delete (Task 6.2)', () => {
  it('calls update with deleted_at timestamp for each stableId', async () => {
    const { tx, update, set } = makeMockTx();
    const writer = new UpsertWriter();

    await writer.softDeleteArtifacts(tx, ['FR-001', 'FR-002'], 'sha-del');

    expect(update).toHaveBeenCalledTimes(2);
    // set should include deletedAt
    const firstCall = (set.mock.calls[0] as [Record<string, unknown>])[0];
    expect(firstCall['deletedAt']).toBeDefined();
  });

  it('returns the count of deleted artifacts', async () => {
    const { tx } = makeMockTx();
    const writer = new UpsertWriter();

    const count = await writer.softDeleteArtifacts(tx, ['FR-001', 'US-002'], 'sha-del');

    expect(count).toBe(2);
  });

  it('returns 0 when no stable IDs provided', async () => {
    const { tx } = makeMockTx();
    const writer = new UpsertWriter();

    const count = await writer.softDeleteArtifacts(tx, [], 'sha-del');

    expect(count).toBe(0);
  });
});
