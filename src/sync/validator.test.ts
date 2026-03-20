import { describe, it, expect } from 'vitest';
import { Validator } from './validator.js';
import type { ParsedArtifact } from '../types.js';

function makeArtifact(overrides: Partial<ParsedArtifact> = {}): ParsedArtifact {
  return {
    stableId: 'FR-001',
    artifactType: 'FR',
    title: 'Sample FR',
    hierarchyNumber: '1.1.1',
    parentStableId: 'US-001',
    status: 'Draft',
    owner: 'alice',
    priority: 'High',
    metadata: {},
    bodyMarkdown: '# FR-001 Sample\n',
    sections: new Map(),
    links: [],
    ...overrides,
  };
}

const validator = new Validator();

describe('Validator – per-artifact rules (Task 5.1)', () => {
  it('passes a valid artifact', () => {
    const result = validator.validateArtifact(makeArtifact(), 'docs/02-requirements/functional/FR-001.md');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('errors when stable ID prefix does not match filename prefix', () => {
    // File is named US-001.md but stableId says FR-001
    const result = validator.validateArtifact(
      makeArtifact({ stableId: 'FR-001', artifactType: 'FR' }),
      'docs/03-delivery-backlog/user-stories/US-001.md',
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'STABLE_ID_MISMATCH')).toBe(true);
  });

  it('errors when a required field is missing for type FR', () => {
    // FR requires status
    const result = validator.validateArtifact(
      makeArtifact({ stableId: 'FR-001', artifactType: 'FR', status: null }),
      'docs/02-requirements/functional/FR-001.md',
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'MISSING_REQUIRED_FIELD')).toBe(true);
  });

  it('warns on malformed artifact ID references in links', () => {
    const result = validator.validateArtifact(
      makeArtifact({
        links: [{ targetId: 'NOTVALID', linkType: 'parent', section: 'Traceability' }],
      }),
      'docs/02-requirements/functional/FR-001.md',
    );
    expect(result.warnings.some(w => w.code === 'MALFORMED_REFERENCE')).toBe(true);
  });

  it('does not warn on valid artifact ID references', () => {
    const result = validator.validateArtifact(
      makeArtifact({
        links: [{ targetId: 'US-001', linkType: 'parent', section: 'Traceability' }],
      }),
      'docs/02-requirements/functional/FR-001.md',
    );
    expect(result.warnings).toHaveLength(0);
  });

  it('is valid even without optional fields', () => {
    const result = validator.validateArtifact(
      makeArtifact({
        stableId: 'EPIC-001',
        artifactType: 'EPIC',
        hierarchyNumber: null,
        parentStableId: null,
        owner: null,
        priority: null,
        status: null,
      }),
      'docs/01-roadmap/epics/EPIC-001.md',
    );
    // EPIC does not require status by default
    expect(result.valid).toBe(true);
  });
});

describe('Validator – batch duplicate detection (Task 5.2)', () => {
  it('detects duplicate stable IDs within a batch', () => {
    const artifacts = [
      makeArtifact({ stableId: 'FR-001' }),
      makeArtifact({ stableId: 'FR-001' }),
      makeArtifact({ stableId: 'FR-002' }),
    ];
    const results = validator.validateBatch(artifacts);
    const duplicateErrors = results.flatMap(r => r.errors).filter(e => e.code === 'DUPLICATE_STABLE_ID');
    expect(duplicateErrors.length).toBeGreaterThan(0);
  });

  it('does not report errors when all stable IDs are unique', () => {
    const artifacts = [
      makeArtifact({ stableId: 'FR-001' }),
      makeArtifact({ stableId: 'FR-002' }),
    ];
    const results = validator.validateBatch(artifacts);
    const duplicateErrors = results.flatMap(r => r.errors).filter(e => e.code === 'DUPLICATE_STABLE_ID');
    expect(duplicateErrors).toHaveLength(0);
  });

  it('individual validation failures do not block other artifacts', () => {
    // One invalid, one valid
    const artifacts = [
      makeArtifact({ stableId: 'INVALID', artifactType: 'FR' }),
      makeArtifact({ stableId: 'FR-002' }),
    ];
    const results = validator.validateBatch(artifacts);
    expect(results).toHaveLength(2);
    // The valid one should pass (or at least not have duplicate errors)
    const fr002Result = results[1];
    expect(fr002Result?.errors.filter(e => e.code === 'DUPLICATE_STABLE_ID')).toHaveLength(0);
  });
});
