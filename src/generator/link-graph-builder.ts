import type {
  GeneratedArtifactMap,
  GeneratedArtifactStub,
  ArtifactLink,
  LinkGraph,
  ArtifactType,
} from '../types.js';

// Artifact types that use parent-child hierarchy
const HIERARCHICAL_TYPES: ReadonlySet<ArtifactType> = new Set([
  'US', 'EN', 'FR', 'EV',
]);

// Cross-cutting types that get assigned to 1–3 parents
const CROSS_CUTTING_TYPES: ReadonlySet<ArtifactType> = new Set([
  'NFR', 'BR', 'UC', 'ENT', 'API', 'SCR', 'ADR', 'AB', 'RB',
]);

export class LinkGraphBuilder {
  buildGraph(artifacts: GeneratedArtifactMap, rng: () => number): LinkGraph {
    const links: ArtifactLink[] = [];
    const parentMap = new Map<string, string>(); // stableId → parentStableId

    // 1. Build parent-child links from stubs
    for (const [, stubs] of artifacts) {
      for (const stub of stubs) {
        if (stub.parentStableId) {
          parentMap.set(stub.stableId, stub.parentStableId);
          links.push({
            targetId: stub.parentStableId,
            linkType: 'parent',
            section: 'Traceability',
          });
        }
      }
    }

    // 2. Assign cross-cutting artifacts to 1–3 parents
    // Collect all potential parent stable IDs (EPICs, USs, ENs, FRs)
    const parentCandidates: string[] = [
      ...(artifacts.get('EPIC') ?? []).map(s => s.stableId),
      ...(artifacts.get('US') ?? []).map(s => s.stableId),
      ...(artifacts.get('EN') ?? []).map(s => s.stableId),
      ...(artifacts.get('FR') ?? []).map(s => s.stableId),
    ];

    for (const type of CROSS_CUTTING_TYPES) {
      const stubs = artifacts.get(type) ?? [];
      for (const stub of stubs) {
        if (parentCandidates.length === 0) continue;
        const count = 1 + Math.floor(rng() * 3); // 1–3 parents
        const assigned = new Set<string>();
        for (let i = 0; i < count && assigned.size < parentCandidates.length; i++) {
          const idx = Math.floor(rng() * parentCandidates.length);
          const parent = parentCandidates[idx];
          if (parent && !assigned.has(parent)) {
            assigned.add(parent);
            links.push({
              targetId: parent,
              linkType: 'cross-cutting',
              section: 'Traceability',
            });
          }
        }
        // Record first assigned as canonical parent
        if (assigned.size > 0) {
          const first = [...assigned][0];
          if (first) parentMap.set(stub.stableId, first);
        }
      }
    }

    // Index by source stable ID for getLinksFor
    // Since links don't carry source yet, we rebuild them with source
    const indexedLinks = new Map<string, ArtifactLink[]>();

    // Re-process to associate links with sources
    for (const [type, stubs] of artifacts) {
      for (const stub of stubs) {
        const stubLinks: ArtifactLink[] = [];

        if (stub.parentStableId) {
          stubLinks.push({ targetId: stub.parentStableId, linkType: 'parent', section: 'Traceability' });
        }

        if (CROSS_CUTTING_TYPES.has(type)) {
          // Already assigned above — we need to re-derive
          const parent = parentMap.get(stub.stableId);
          if (parent && !stub.parentStableId) {
            stubLinks.push({ targetId: parent, linkType: 'cross-cutting', section: 'Traceability' });
          }
        }

        indexedLinks.set(stub.stableId, stubLinks);
      }
    }

    const allLinks: ArtifactLink[] = [];
    for (const [stableId, ls] of indexedLinks) {
      for (const l of ls) {
        allLinks.push({ ...l, section: stableId }); // use stableId as section key for source
      }
    }

    return {
      links: allLinks,
      getLinksFor(stableId: string): ArtifactLink[] {
        return indexedLinks.get(stableId) ?? [];
      },
      getParent(stableId: string): string | null {
        return parentMap.get(stableId) ?? null;
      },
    };
  }
}
