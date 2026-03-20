import { eq } from 'drizzle-orm';
import { artifacts, artifactLinks } from '../db/schema.js';
import type { DrizzleTransaction } from '../db/connection.js';

export interface LinkResolutionResult {
  linksCreated: number;
  danglingReferences: Array<{ sourceId: string; targetId: string }>;
}

interface LinkJsonEntry {
  target_id: string;
  link_type: string;
  section: string;
}

export class LinkResolver {
  /**
   * Second-pass resolution: reads links_json from all artifacts and inserts
   * valid rows into artifact_links. Logs dangling references as warnings.
   */
  async resolveLinks(tx: DrizzleTransaction): Promise<LinkResolutionResult> {
    let linksCreated = 0;
    const danglingReferences: Array<{ sourceId: string; targetId: string }> = [];

    // Fetch all artifact rows with their links_json
    const rows = await tx.select().from(artifacts) as Array<{
      stableId: string;
      linksJson: unknown;
    }>;

    // Build a set of known stable IDs for fast lookup
    const knownIds = new Set(rows.map(r => r.stableId));

    for (const row of rows) {
      const linksJson = (row.linksJson ?? []) as LinkJsonEntry[];
      if (!Array.isArray(linksJson) || linksJson.length === 0) continue;

      for (const link of linksJson) {
        if (!link.target_id) continue;

        if (!knownIds.has(link.target_id)) {
          // Dangling reference
          danglingReferences.push({ sourceId: row.stableId, targetId: link.target_id });
          console.warn(`[LinkResolver] Dangling reference: ${row.stableId} → ${link.target_id}`);
          continue;
        }

        // Insert normalized link
        await tx.insert(artifactLinks).values({
          sourceStableId: row.stableId,
          targetStableId: link.target_id,
          linkType: link.link_type ?? 'unknown',
          sourceSection: link.section ?? 'unknown',
        });
        linksCreated++;
      }
    }

    return { linksCreated, danglingReferences };
  }
}
