import { describe, it, expect } from 'vitest';
import { LinkGraphBuilder } from './link-graph-builder.js';
import type { GeneratedArtifactMap } from '../types.js';

function makeArtifactMap(): GeneratedArtifactMap {
  const map: GeneratedArtifactMap = new Map();
  map.set('EPIC', [
    { stableId: 'EPIC-001', title: 'Epic One', hierarchyNumber: '1', parentStableId: null },
    { stableId: 'EPIC-002', title: 'Epic Two', hierarchyNumber: '2', parentStableId: null },
  ]);
  map.set('US', [
    { stableId: 'US-001', title: 'Story One', hierarchyNumber: '1.1', parentStableId: 'EPIC-001' },
    { stableId: 'US-002', title: 'Story Two', hierarchyNumber: '1.2', parentStableId: 'EPIC-001' },
  ]);
  map.set('FR', [
    { stableId: 'FR-001', title: 'FR One', hierarchyNumber: '1.1.1', parentStableId: 'US-001' },
  ]);
  map.set('EN', []);
  map.set('EV', [
    { stableId: 'EV-001', title: 'EV One', hierarchyNumber: '1.1.1.E1', parentStableId: 'FR-001' },
  ]);
  // Cross-cutting
  map.set('NFR', [
    { stableId: 'NFR-001', title: 'NFR One', hierarchyNumber: 'X.1', parentStableId: null },
  ]);
  return map;
}

const builder = new LinkGraphBuilder();
const rng = () => 0.5; // deterministic mock

describe('LinkGraphBuilder – parent-child links (Task 10.2)', () => {
  it('builds links from parent-child stubs', () => {
    const map = makeArtifactMap();
    const graph = builder.buildGraph(map, rng);
    // US-001 has parent EPIC-001 → should have a link
    const usLinks = graph.getLinksFor('US-001');
    expect(usLinks.some(l => l.targetId === 'EPIC-001')).toBe(true);
  });

  it('getParent returns the parent stable ID', () => {
    const map = makeArtifactMap();
    const graph = builder.buildGraph(map, rng);
    expect(graph.getParent('US-001')).toBe('EPIC-001');
    expect(graph.getParent('EPIC-001')).toBeNull();
  });

  it('EV links to its parent FR', () => {
    const map = makeArtifactMap();
    const graph = builder.buildGraph(map, rng);
    const evLinks = graph.getLinksFor('EV-001');
    expect(evLinks.some(l => l.targetId === 'FR-001')).toBe(true);
  });

  it('assigns cross-cutting artifacts to parents', () => {
    const map = makeArtifactMap();
    const graph = builder.buildGraph(map, rng);
    // NFR-001 should be linked to at least one artifact
    const nfrLinks = graph.getLinksFor('NFR-001');
    expect(nfrLinks.length).toBeGreaterThanOrEqual(1);
  });
});

describe('LinkGraphBuilder – determinism (Task 8.3)', () => {
  it('produces identical graphs with same RNG', () => {
    const map1 = makeArtifactMap();
    const map2 = makeArtifactMap();
    const rng1 = () => 0.42;
    const rng2 = () => 0.42;
    const graph1 = builder.buildGraph(map1, rng1);
    const graph2 = builder.buildGraph(map2, rng2);
    expect(graph1.links.length).toBe(graph2.links.length);
  });
});
