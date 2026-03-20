import { describe, it, expect, vi } from 'vitest';
import { LinkResolver } from './link-resolver.js';

// ─── Mock tx helpers ──────────────────────────────────────────

type ArtifactRow = { stableId: string; linksJson: unknown };

function makeTxWithRows(rows: ArtifactRow[]) {
  const valuesInsert = vi.fn().mockResolvedValue([]);
  const insertFn = vi.fn().mockReturnValue({ values: valuesInsert });

  // select().from(artifacts) → rows
  const fromFn = vi.fn().mockResolvedValue(rows);
  const selectFn = vi.fn().mockReturnValue({ from: fromFn });

  const tx = { insert: insertFn, select: selectFn } as unknown as Parameters<
    Parameters<ReturnType<typeof import('../db/connection.js').createDb>['transaction']>[0]
  >[0];

  return { tx, insertFn, valuesInsert };
}

describe('LinkResolver – link resolution (Task 11.1)', () => {
  it('returns zero links when no artifacts have links_json entries', async () => {
    const { tx } = makeTxWithRows([
      { stableId: 'FR-001', linksJson: [] },
      { stableId: 'US-001', linksJson: [] },
    ]);
    const resolver = new LinkResolver();
    const result = await resolver.resolveLinks(tx);
    expect(result.linksCreated).toBe(0);
    expect(result.danglingReferences).toHaveLength(0);
  });

  it('inserts a link when target artifact exists', async () => {
    const { tx, valuesInsert } = makeTxWithRows([
      {
        stableId: 'FR-001',
        linksJson: [{ target_id: 'US-001', link_type: 'parent', section: 'Traceability' }],
      },
      { stableId: 'US-001', linksJson: [] },
    ]);
    const resolver = new LinkResolver();
    const result = await resolver.resolveLinks(tx);
    expect(result.linksCreated).toBe(1);
    expect(valuesInsert).toHaveBeenCalledOnce();
    const inserted = (valuesInsert.mock.calls[0] as [Record<string, string>])[0];
    expect(inserted['sourceStableId']).toBe('FR-001');
    expect(inserted['targetStableId']).toBe('US-001');
  });
});

describe('LinkResolver – dangling references (Task 11.2)', () => {
  it('reports dangling reference when target does not exist', async () => {
    const { tx } = makeTxWithRows([
      {
        stableId: 'FR-001',
        linksJson: [{ target_id: 'EPIC-999', link_type: 'parent', section: 'Traceability' }],
      },
    ]);
    const resolver = new LinkResolver();
    const result = await resolver.resolveLinks(tx);
    expect(result.linksCreated).toBe(0);
    expect(result.danglingReferences).toHaveLength(1);
    expect(result.danglingReferences[0]?.sourceId).toBe('FR-001');
    expect(result.danglingReferences[0]?.targetId).toBe('EPIC-999');
  });

  it('does not insert link for dangling reference', async () => {
    const { tx, valuesInsert } = makeTxWithRows([
      {
        stableId: 'FR-001',
        linksJson: [{ target_id: 'DOES-NOT-EXIST-999', link_type: 'parent', section: 'Traceability' }],
      },
    ]);
    const resolver = new LinkResolver();
    await resolver.resolveLinks(tx);
    expect(valuesInsert).not.toHaveBeenCalled();
  });
});
