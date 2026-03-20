import path from 'node:path';
import {
  type ParsedArtifact,
  type ArtifactType,
  type ValidationResult,
  type ValidationError,
  type ValidationWarning,
  STABLE_ID_REGEX,
} from '../types.js';

// ─── Required fields per artifact type ───────────────────────

const REQUIRED_FIELDS: Partial<Record<ArtifactType, ReadonlyArray<keyof ParsedArtifact>>> = {
  FR: ['status'],
  NFR: ['status'],
  BR: ['status'],
  US: ['status'],
  EN: ['status'],
};

export class Validator {
  validateArtifact(artifact: ParsedArtifact, filePath: string): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // 3.1 Stable ID must match filename prefix
    const fileBase = path.basename(filePath, '.md'); // e.g. "FR-001"
    const filePrefix = fileBase.split('-')[0] ?? '';
    const idPrefix = artifact.stableId.split('-')[0] ?? '';
    if (filePrefix && idPrefix && filePrefix !== idPrefix) {
      errors.push({
        filePath,
        field: 'stableId',
        message: `Stable ID prefix "${idPrefix}" does not match filename prefix "${filePrefix}"`,
        code: 'STABLE_ID_MISMATCH',
      });
    }

    // 3.2 Required fields per artifact type
    const required = REQUIRED_FIELDS[artifact.artifactType] ?? [];
    for (const field of required) {
      const value = artifact[field];
      if (value === null || value === undefined || value === '') {
        errors.push({
          filePath,
          field: String(field),
          message: `Required field "${String(field)}" is missing for artifact type ${artifact.artifactType}`,
          code: 'MISSING_REQUIRED_FIELD',
        });
      }
    }

    // 3.3 Warn on malformed artifact ID references
    for (const link of artifact.links) {
      if (!STABLE_ID_REGEX.test(link.targetId)) {
        warnings.push({
          filePath,
          message: `Malformed artifact reference "${link.targetId}" in section "${link.section}"`,
          code: 'MALFORMED_REFERENCE',
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  validateBatch(artifacts: ParsedArtifact[]): ValidationResult[] {
    // 3.4 Detect duplicate stable IDs
    const seenIds = new Map<string, number[]>(); // stableId → indices
    for (let i = 0; i < artifacts.length; i++) {
      const artifact = artifacts[i];
      if (!artifact) continue;
      const existing = seenIds.get(artifact.stableId);
      if (existing) {
        existing.push(i);
      } else {
        seenIds.set(artifact.stableId, [i]);
      }
    }

    const duplicateIndices = new Set<number>();
    for (const [, indices] of seenIds) {
      if (indices.length > 1) {
        for (const idx of indices) {
          duplicateIndices.add(idx);
        }
      }
    }

    // Run per-artifact validation + add duplicate errors
    return artifacts.map((artifact, i) => {
      const filePath = artifact.stableId; // no filePath in batch context
      const result = this.validateArtifact(artifact, filePath);

      if (duplicateIndices.has(i)) {
        result.errors.push({
          filePath,
          field: 'stableId',
          message: `Duplicate stable ID "${artifact.stableId}" detected in batch`,
          code: 'DUPLICATE_STABLE_ID',
        });
        result.valid = false;
      }

      return result;
    });
  }
}
