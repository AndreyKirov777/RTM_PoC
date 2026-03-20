import { describe, it, expect } from 'vitest';
import { MarkdownParser } from './parser.js';

const parser = new MarkdownParser();

// ─── Helper ──────────────────────────────────────────────────

function makeArtifact(prefix: string, num: string, extras: string = ''): string {
  return `# ${prefix}-${num} Sample Title

## Identification

- **Stable ID**: ${prefix}-${num}
- **Hierarchy Number**: 1.${num}
- **Parent**: EPIC-001
- **Type**: ${prefix}

## Metadata

- **Status**: Draft
- **Owner**: alice
- **Priority**: High

## Description

This is the body of the artifact.

${extras}`;
}

// ─── Core parsing ─────────────────────────────────────────────

describe('MarkdownParser – core parsing (Task 3.1)', () => {
  it('extracts stableId from Identification section', () => {
    const result = parser.parseArtifact('docs/01-roadmap/epics/EPIC-001.md', makeArtifact('EPIC', '001'));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.stableId).toBe('EPIC-001');
  });

  it('extracts H1 title', () => {
    const result = parser.parseArtifact('docs/01-roadmap/epics/EPIC-001.md', makeArtifact('EPIC', '001'));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.title).toBe('EPIC-001 Sample Title');
  });

  it('extracts hierarchyNumber', () => {
    const result = parser.parseArtifact('docs/01-roadmap/epics/EPIC-001.md', makeArtifact('EPIC', '001'));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.hierarchyNumber).toBe('1.001');
  });

  it('extracts parentStableId', () => {
    const result = parser.parseArtifact('docs/02-requirements/functional/FR-001.md', makeArtifact('FR', '001'));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.parentStableId).toBe('EPIC-001');
  });

  it('extracts status from Metadata section', () => {
    const result = parser.parseArtifact('docs/01-roadmap/epics/EPIC-001.md', makeArtifact('EPIC', '001'));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe('Draft');
  });

  it('extracts owner', () => {
    const result = parser.parseArtifact('docs/01-roadmap/epics/EPIC-001.md', makeArtifact('EPIC', '001'));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.owner).toBe('alice');
  });

  it('extracts priority', () => {
    const result = parser.parseArtifact('docs/01-roadmap/epics/EPIC-001.md', makeArtifact('EPIC', '001'));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.priority).toBe('High');
  });

  it('captures bodyMarkdown', () => {
    const result = parser.parseArtifact('docs/01-roadmap/epics/EPIC-001.md', makeArtifact('EPIC', '001'));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.bodyMarkdown).toContain('This is the body');
  });

  it('captures sections map', () => {
    const result = parser.parseArtifact('docs/01-roadmap/epics/EPIC-001.md', makeArtifact('EPIC', '001'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sections.has('Description')).toBe(true);
    }
  });
});

// ─── All 16 artifact types ────────────────────────────────────

describe('MarkdownParser – all 16 artifact types (Task 3.4)', () => {
  const cases: Array<[string, string]> = [
    ['EPIC', 'docs/01-roadmap/epics/EPIC-001.md'],
    ['US', 'docs/03-delivery-backlog/user-stories/US-001.md'],
    ['EN', 'docs/03-delivery-backlog/enablers/EN-001.md'],
    ['FR', 'docs/02-requirements/functional/FR-001.md'],
    ['NFR', 'docs/02-requirements/non-functional/NFR-001.md'],
    ['BR', 'docs/02-requirements/business-rules/BR-001.md'],
    ['UC', 'docs/04-use-cases/UC-001.md'],
    ['ENT', 'docs/05-domain-model/entities/ENT-001.md'],
    ['API', 'docs/06-api/endpoints/API-001.md'],
    ['SCR', 'docs/08-ux/screens/SCR-001.md'],
    ['ADR', 'docs/07-architecture/adrs/ADR-001.md'],
    ['EV', 'docs/11-evals/scenarios/EV-001.md'],
    ['AB', 'docs/09-security/abuse-cases/AB-001.md'],
    ['RB', 'docs/10-operations/runbooks/RB-001.md'],
    ['MS', 'docs/01-roadmap/milestones/MS-001.md'],
    ['REL', 'docs/01-roadmap/release-slices/REL-001.md'],
  ];

  for (const [prefix, filePath] of cases) {
    it(`parses ${prefix} artifact successfully`, () => {
      const content = makeArtifact(prefix, '001');
      const result = parser.parseArtifact(filePath, content);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stableId).toBe(`${prefix}-001`);
        expect(result.value.artifactType).toBe(prefix);
      }
    });
  }
});

// ─── Link extraction (Task 3.2) ───────────────────────────────

describe('MarkdownParser – link extraction (Task 3.2)', () => {
  it('extracts artifact ID references from Traceability section', () => {
    const content = makeArtifact('FR', '001', `## Traceability

- **Linked requirements**: US-002, EPIC-001
- **Verifies**: NFR-003
`);
    const result = parser.parseArtifact('docs/02-requirements/functional/FR-001.md', content);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const links = result.value.links;
      expect(links.some(l => l.targetId === 'US-002')).toBe(true);
      expect(links.some(l => l.targetId === 'EPIC-001')).toBe(true);
      expect(links.some(l => l.targetId === 'NFR-003')).toBe(true);
    }
  });

  it('stores the link type from list key', () => {
    const content = makeArtifact('FR', '001', `## Traceability

- **Linked requirements**: US-002
`);
    const result = parser.parseArtifact('docs/02-requirements/functional/FR-001.md', content);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const link = result.value.links.find(l => l.targetId === 'US-002');
      expect(link?.linkType).toBe('Linked requirements');
      expect(link?.section).toBe('Traceability');
    }
  });

  it('parses inline acceptance criteria', () => {
    const content = makeArtifact('FR', '001', `## Acceptance Criteria

1. Given a user is logged in, when they click submit, then the form is saved.
2. Given invalid input, when submitted, then an error is shown.
`);
    const result = parser.parseArtifact('docs/02-requirements/functional/FR-001.md', content);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.metadata['acceptanceCriteria']).toBeDefined();
    }
  });
});

// ─── Type inference and skipping (Task 3.3) ───────────────────

describe('MarkdownParser – type inference and non-artifact skipping (Task 3.3)', () => {
  it('infers artifact type from stable ID prefix', () => {
    const result = parser.parseArtifact('docs/02-requirements/functional/FR-001.md', makeArtifact('FR', '001'));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.artifactType).toBe('FR');
  });

  it('returns error for file with no H1 heading', () => {
    const result = parser.parseArtifact('docs/01-roadmap/epics/vision.md', 'No heading here\n\nJust text.');
    expect(result.ok).toBe(false);
  });

  it('returns error for file with no Identification section', () => {
    const result = parser.parseArtifact('docs/01-roadmap/epics/scope.md', `# Scope

## Overview

Just some text, no Identification section.
`);
    expect(result.ok).toBe(false);
  });

  it('returns error for unknown stable ID prefix (non-artifact file)', () => {
    const result = parser.parseArtifact('docs/01-roadmap/epics/vision.md', `# Vision

## Identification

- **Stable ID**: VIS-001
- **Type**: VIS
`);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('Unknown artifact type prefix');
    }
  });
});

// ─── Edge cases (Task 3.4) ────────────────────────────────────

describe('MarkdownParser – edge cases (Task 3.4)', () => {
  it('handles missing optional fields gracefully', () => {
    const content = `# EPIC-001 Minimal

## Identification

- **Stable ID**: EPIC-001
- **Type**: EPIC
`;
    const result = parser.parseArtifact('docs/01-roadmap/epics/EPIC-001.md', content);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.hierarchyNumber).toBeNull();
      expect(result.value.parentStableId).toBeNull();
      expect(result.value.status).toBeNull();
    }
  });

  it('does not extract headings inside code blocks as section names', () => {
    const content = makeArtifact('EPIC', '001', `## Code Example

\`\`\`markdown
## This is not a section
\`\`\`
`);
    const result = parser.parseArtifact('docs/01-roadmap/epics/EPIC-001.md', content);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The fake section inside code block should not appear as a real section
      expect(result.value.sections.has('This is not a section')).toBe(false);
    }
  });

  it('captures all extra metadata key-value pairs', () => {
    const content = `# FR-001 Title

## Identification

- **Stable ID**: FR-001
- **Type**: FR

## Metadata

- **Status**: Approved
- **Owner**: bob
- **Custom Field**: custom value
`;
    const result = parser.parseArtifact('docs/02-requirements/functional/FR-001.md', content);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.metadata['Custom Field']).toBe('custom value');
    }
  });
});
