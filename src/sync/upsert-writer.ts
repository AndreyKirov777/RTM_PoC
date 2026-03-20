import { eq } from 'drizzle-orm';
import { artifacts } from '../db/schema.js';
import type { DrizzleTransaction } from '../db/connection.js';
import type { ParsedArtifact, UpsertResult } from '../types.js';

export class UpsertWriter {
  /**
   * Upsert an artifact row; conflict target is stable_id.
   * Returns whether the row was created or updated.
   */
  async upsertArtifact(
    tx: DrizzleTransaction,
    artifact: ParsedArtifact,
    commitSha: string,
    filePath: string,
  ): Promise<UpsertResult> {
    const now = new Date();

    const linksJson = artifact.links.map(l => ({
      target_id: l.targetId,
      link_type: l.linkType,
      section: l.section,
    }));

    const metadataJson: Record<string, string> = {
      ...artifact.metadata,
    };

    const row = {
      stableId: artifact.stableId,
      artifactType: artifact.artifactType,
      hierarchyNumber: artifact.hierarchyNumber ?? undefined,
      title: artifact.title,
      status: artifact.status ?? undefined,
      owner: artifact.owner ?? undefined,
      priority: artifact.priority ?? undefined,
      parentStableId: artifact.parentStableId ?? undefined,
      metadataJson,
      bodyMarkdown: artifact.bodyMarkdown,
      linksJson,
      filePath,
      sourceCommitSha: commitSha,
      syncedAt: now,
    };

    await tx
      .insert(artifacts)
      .values(row)
      .onConflictDoUpdate({
        target: artifacts.stableId,
        set: {
          artifactType: row.artifactType,
          hierarchyNumber: row.hierarchyNumber,
          title: row.title,
          status: row.status,
          owner: row.owner,
          priority: row.priority,
          parentStableId: row.parentStableId,
          metadataJson: row.metadataJson,
          bodyMarkdown: row.bodyMarkdown,
          linksJson: row.linksJson,
          filePath: row.filePath,
          sourceCommitSha: row.sourceCommitSha,
          syncedAt: row.syncedAt,
          deletedAt: undefined, // clear soft-delete if re-added
        },
      });

    return { stableId: artifact.stableId, action: 'created' };
  }

  /**
   * Soft-delete artifacts by stable ID.
   * Returns the number of rows affected.
   */
  async softDeleteArtifacts(
    tx: DrizzleTransaction,
    stableIds: string[],
    _commitSha: string,
  ): Promise<number> {
    if (stableIds.length === 0) return 0;

    const now = new Date();
    for (const id of stableIds) {
      await tx
        .update(artifacts)
        .set({ deletedAt: now })
        .where(eq(artifacts.stableId, id));
    }
    return stableIds.length;
  }
}
