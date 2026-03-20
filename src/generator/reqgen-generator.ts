import fs from 'node:fs/promises';
import path from 'node:path';
import seedrandom from 'seedrandom';
import {
  type GeneratorConfig,
  type GeneratorResult,
  type GeneratedArtifactMap,
  type GeneratedArtifactStub,
  type ArtifactType,
  TRACKED_DIRS,
} from '../types.js';
import { LinkGraphBuilder } from './link-graph-builder.js';

// ─── Directory map per artifact type ─────────────────────────

const TYPE_DIR: Partial<Record<ArtifactType, string>> = {
  EPIC: 'docs/01-roadmap/epics',
  MS: 'docs/01-roadmap/milestones',
  REL: 'docs/01-roadmap/release-slices',
  FR: 'docs/02-requirements/functional',
  NFR: 'docs/02-requirements/non-functional',
  BR: 'docs/02-requirements/business-rules',
  US: 'docs/03-delivery-backlog/user-stories',
  EN: 'docs/03-delivery-backlog/enablers',
  UC: 'docs/04-use-cases',
  ENT: 'docs/05-domain-model/entities',
  API: 'docs/06-api/endpoints',
  ADR: 'docs/07-architecture/adrs',
  SCR: 'docs/08-ux/screens',
  AB: 'docs/09-security/abuse-cases',
  RB: 'docs/10-operations/runbooks',
  EV: 'docs/11-evals/scenarios',
};

const linkBuilder = new LinkGraphBuilder();

export class ReqgenGenerator {
  async generate(config: GeneratorConfig): Promise<GeneratorResult> {
    const rng = config.seed !== null ? seedrandom(String(config.seed)) : seedrandom();

    // 1. Build artifact stubs
    const artifactMap = this.buildArtifactMap(config);

    // 2. Build link graph
    const graph = linkBuilder.buildGraph(artifactMap, rng);

    // 3. Ensure directory structure exists
    await this.ensureDirs(config.outputPath);

    // 4. Write artifact files
    let totalFiles = 0;
    const artifactCounts: Partial<Record<ArtifactType, number>> = {};

    for (const [type, stubs] of artifactMap) {
      const dir = TYPE_DIR[type];
      if (!dir || stubs.length === 0) {
        artifactCounts[type] = 0;
        continue;
      }
      artifactCounts[type] = stubs.length;

      for (const stub of stubs) {
        const links = graph.getLinksFor(stub.stableId);
        const content = this.renderArtifact(type, stub, links);
        const filePath = path.join(config.outputPath, dir, `${stub.stableId}.md`);
        await fs.writeFile(filePath, content, 'utf8');
        totalFiles++;
      }
    }

    // 5. Generate static docs
    await this.writeStaticDocs(config.outputPath);
    totalFiles += 4; // README, vision, scope, glossary

    // 6. Traceability matrix
    await this.writeTraceabilityMatrix(config.outputPath, artifactMap, graph);
    totalFiles++;

    // 7. Malformed files
    let malformedFiles = 0;
    if (config.malformed > 0) {
      malformedFiles = await this.writeMalformedFiles(config.outputPath, config.malformed);
      totalFiles += malformedFiles;
    }

    return {
      outputPath: config.outputPath,
      artifactCounts: this.fillCounts(artifactCounts),
      totalFiles,
      commits: 0, // updated by GitHistoryBuilder if gitHistory = true
      malformedFiles,
    };
  }

  // ─── Build artifact stubs ──────────────────────────────────

  private buildArtifactMap(config: GeneratorConfig): GeneratedArtifactMap {
    const map: GeneratedArtifactMap = new Map();
    const counters: Partial<Record<ArtifactType, number>> = {};
    function nextId(type: ArtifactType): string {
      const n = (counters[type] ?? 0) + 1;
      counters[type] = n;
      return `${type}-${String(n).padStart(3, '0')}`;
    }

    // Milestones & releases
    map.set('MS', Array.from({ length: config.milestones }, (_, i) => ({
      stableId: nextId('MS'),
      title: `Milestone ${i + 1}`,
      hierarchyNumber: `M${i + 1}`,
      parentStableId: null,
    })));
    map.set('REL', Array.from({ length: config.releases }, (_, i) => ({
      stableId: nextId('REL'),
      title: `Release ${i + 1}`,
      hierarchyNumber: `R${i + 1}`,
      parentStableId: null,
    })));

    // Epics
    const epics: GeneratedArtifactStub[] = [];
    for (let e = 0; e < config.epics; e++) {
      epics.push({ stableId: nextId('EPIC'), title: `Epic ${e + 1}`, hierarchyNumber: `${e + 1}`, parentStableId: null });
    }
    map.set('EPIC', epics);

    // Stories & enablers under each epic
    const stories: GeneratedArtifactStub[] = [];
    const enablers: GeneratedArtifactStub[] = [];
    const frs: GeneratedArtifactStub[] = [];
    const evs: GeneratedArtifactStub[] = [];

    for (const epic of epics) {
      for (let s = 0; s < config.storiesPerEpic; s++) {
        const us: GeneratedArtifactStub = {
          stableId: nextId('US'),
          title: `User Story for ${epic.stableId}`,
          hierarchyNumber: `${epic.hierarchyNumber}.${s + 1}`,
          parentStableId: epic.stableId,
        };
        stories.push(us);

        for (let r = 0; r < config.reqsPerStory; r++) {
          const fr: GeneratedArtifactStub = {
            stableId: nextId('FR'),
            title: `FR for ${us.stableId}`,
            hierarchyNumber: `${us.hierarchyNumber}.${r + 1}`,
            parentStableId: us.stableId,
          };
          frs.push(fr);

          for (let ev = 0; ev < config.evalsPerReq; ev++) {
            evs.push({
              stableId: nextId('EV'),
              title: `Eval for ${fr.stableId}`,
              hierarchyNumber: `${fr.hierarchyNumber}.E${ev + 1}`,
              parentStableId: fr.stableId,
            });
          }
        }
      }

      for (let en = 0; en < config.enablersPerEpic; en++) {
        enablers.push({
          stableId: nextId('EN'),
          title: `Enabler for ${epic.stableId}`,
          hierarchyNumber: `${epic.hierarchyNumber}.EN${en + 1}`,
          parentStableId: epic.stableId,
        });
      }
    }
    map.set('US', stories);
    map.set('EN', enablers);
    map.set('FR', frs);
    map.set('EV', evs);

    // Cross-cutting (split evenly among types)
    const crossCuttingTypes: ArtifactType[] = ['NFR', 'BR', 'UC', 'ENT', 'API', 'SCR', 'ADR', 'AB', 'RB'];
    const perType = Math.ceil(config.crossCutting / crossCuttingTypes.length);
    for (const type of crossCuttingTypes) {
      map.set(type, Array.from({ length: Math.min(perType, config.crossCutting) }, (_, i) => ({
        stableId: nextId(type),
        title: `${type} Artifact ${i + 1}`,
        hierarchyNumber: `X.${i + 1}`,
        parentStableId: null,
      })));
    }

    return map;
  }

  // ─── Render artifact content ───────────────────────────────

  private renderArtifact(
    type: ArtifactType,
    stub: GeneratedArtifactStub,
    links: import('../types.js').ArtifactLink[],
  ): string {
    const traceLines = links.map(l => `- **${l.linkType}**: ${l.targetId}`).join('\n');
    const traceSection = traceLines
      ? `\n## Traceability\n\n${traceLines}\n`
      : '';

    return `# ${stub.stableId} ${stub.title}

## Identification

- **Stable ID**: ${stub.stableId}
- **Hierarchy Number**: ${stub.hierarchyNumber}
- **Type**: ${type}${stub.parentStableId ? `\n- **Parent**: ${stub.parentStableId}` : ''}

## Metadata

- **Status**: Draft
- **Owner**: generated
- **Priority**: Medium

## Description

Generated ${type} artifact: ${stub.title}.
${traceSection}
## Acceptance Criteria

1. Given the artifact exists, when reviewed, then it meets the definition of done.
`;
  }

  // ─── Static docs ──────────────────────────────────────────

  private async writeStaticDocs(outputPath: string): Promise<void> {
    await fs.writeFile(path.join(outputPath, 'README.md'), '# Spec Repository\n\nGenerated by reqgen.\n', 'utf8');
    await fs.writeFile(path.join(outputPath, 'vision.md'), '# Vision\n\nPlaceholder vision content.\n', 'utf8');
    await fs.writeFile(path.join(outputPath, 'scope.md'), '# Scope\n\nPlaceholder scope content.\n', 'utf8');
    await fs.writeFile(path.join(outputPath, 'glossary.md'), '# Glossary\n\nPlaceholder glossary content.\n', 'utf8');
  }

  // ─── Traceability matrix ──────────────────────────────────

  private async writeTraceabilityMatrix(
    outputPath: string,
    artifacts: GeneratedArtifactMap,
    graph: import('../types.js').LinkGraph,
  ): Promise<void> {
    const dir = path.join(outputPath, 'docs/13-traceability');
    await fs.mkdir(dir, { recursive: true });

    const lines: string[] = ['# Traceability Matrix\n', '| Source | Target | Link Type |', '|--------|--------|-----------|'];
    for (const [, stubs] of artifacts) {
      for (const stub of stubs) {
        for (const link of graph.getLinksFor(stub.stableId)) {
          lines.push(`| ${stub.stableId} | ${link.targetId} | ${link.linkType} |`);
        }
      }
    }
    await fs.writeFile(path.join(dir, 'matrix.md'), lines.join('\n') + '\n', 'utf8');
  }

  // ─── Malformed files ──────────────────────────────────────

  private async writeMalformedFiles(outputPath: string, count: number): Promise<number> {
    const malformDir = path.join(outputPath, 'docs/01-roadmap/epics');
    const defects = [
      // Missing Identification section
      '# EPIC-999 Missing Ident\n\n## Description\n\nNo Identification section.\n',
      // Stable ID mismatch
      '# EPIC-998 ID Mismatch\n\n## Identification\n\n- **Stable ID**: FR-001\n\n## Description\n\nID does not match filename.\n',
      // Missing required fields
      '# FR-997 Missing Fields\n\n## Identification\n\n- **Stable ID**: FR-997\n\n## Description\n\nNo metadata section.\n',
      // Duplicate stable ID (same as first EPIC)
      '# EPIC-001 Duplicate\n\n## Identification\n\n- **Stable ID**: EPIC-001\n\n## Metadata\n\n- **Status**: Draft\n',
      // Garbled Markdown
      '## ##garbled## content\n\n---\n\n```broken yaml\nkey: [\n```\n',
    ];

    let written = 0;
    for (let i = 0; i < count && i < defects.length; i++) {
      const content = defects[i] ?? '';
      await fs.writeFile(
        path.join(malformDir, `MALFORMED-${String(i + 1).padStart(3, '0')}.md`),
        content,
        'utf8',
      );
      written++;
    }
    return written;
  }

  // ─── Ensure directory structure ───────────────────────────

  private async ensureDirs(outputPath: string): Promise<void> {
    for (const dir of TRACKED_DIRS) {
      await fs.mkdir(path.join(outputPath, dir), { recursive: true });
    }
  }

  private fillCounts(partial: Partial<Record<ArtifactType, number>>): Record<ArtifactType, number> {
    const allTypes: ArtifactType[] = [
      'EPIC', 'US', 'EN', 'FR', 'NFR', 'BR', 'UC',
      'ENT', 'API', 'SCR', 'ADR', 'EV', 'AB', 'RB', 'MS', 'REL',
    ];
    const result = {} as Record<ArtifactType, number>;
    for (const t of allTypes) {
      result[t] = partial[t] ?? 0;
    }
    return result;
  }
}
