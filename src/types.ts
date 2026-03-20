// ============================================================
// Shared domain types and constants (Task 1.2)
// ============================================================

// ─── Artifact Types ──────────────────────────────────────────

export const ARTIFACT_TYPES = [
  'EPIC', 'US', 'EN', 'FR', 'NFR', 'BR', 'UC',
  'ENT', 'API', 'SCR', 'ADR', 'EV', 'AB', 'RB', 'MS', 'REL',
] as const;

export type ArtifactType = typeof ARTIFACT_TYPES[number];

// ─── Stable ID Pattern ───────────────────────────────────────

/** Matches PREFIX-NNN e.g. EPIC-001, FR-042 */
export const STABLE_ID_REGEX =
  /^(EPIC|US|EN|FR|NFR|BR|UC|ENT|API|SCR|ADR|EV|AB|RB|MS|REL)-\d{3,}$/;

/** Prefix-to-type mapping */
export const PREFIX_TO_TYPE: Record<string, ArtifactType> = {
  EPIC: 'EPIC',
  US: 'US',
  EN: 'EN',
  FR: 'FR',
  NFR: 'NFR',
  BR: 'BR',
  UC: 'UC',
  ENT: 'ENT',
  API: 'API',
  SCR: 'SCR',
  ADR: 'ADR',
  EV: 'EV',
  AB: 'AB',
  RB: 'RB',
  MS: 'MS',
  REL: 'REL',
};

// ─── Tracked Artifact Directories ────────────────────────────

export const TRACKED_DIRS: readonly string[] = [
  'docs/01-roadmap/epics',
  'docs/01-roadmap/milestones',
  'docs/01-roadmap/release-slices',
  'docs/02-requirements/functional',
  'docs/02-requirements/non-functional',
  'docs/02-requirements/business-rules',
  'docs/03-delivery-backlog/user-stories',
  'docs/03-delivery-backlog/enablers',
  'docs/04-use-cases',
  'docs/05-domain-model/entities',
  'docs/06-api/endpoints',
  'docs/07-architecture/adrs',
  'docs/08-ux/screens',
  'docs/09-security/abuse-cases',
  'docs/10-operations/runbooks',
  'docs/11-evals/scenarios',
] as const;

// ─── Processing Order (dependency-ordered) ───────────────────

export const ARTIFACT_TYPE_ORDER: readonly ArtifactType[] = [
  'EPIC', 'MS', 'REL', 'US', 'EN', 'FR', 'NFR', 'BR',
  'UC', 'ENT', 'API', 'SCR', 'ADR', 'AB', 'RB', 'EV',
] as const;

// ─── Parsed Artifact ─────────────────────────────────────────

export interface ArtifactLink {
  targetId: string;
  linkType: string;
  section: string;
}

export interface ParsedArtifact {
  stableId: string;
  artifactType: ArtifactType;
  title: string;
  hierarchyNumber: string | null;
  parentStableId: string | null;
  status: string | null;
  owner: string | null;
  priority: string | null;
  metadata: Record<string, string>;
  bodyMarkdown: string;
  sections: Map<string, string>;
  links: ArtifactLink[];
}

// ─── Parse Error ─────────────────────────────────────────────

export interface ParseError {
  filePath: string;
  message: string;
  line: number | null;
}

// ─── Result Type ─────────────────────────────────────────────

export type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export function Ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function Err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

// ─── Validation ──────────────────────────────────────────────

export interface ValidationError {
  filePath: string;
  field: string;
  message: string;
  code: 'STABLE_ID_MISMATCH' | 'MISSING_REQUIRED_FIELD' | 'DUPLICATE_STABLE_ID';
}

export interface ValidationWarning {
  filePath: string;
  message: string;
  code: 'MALFORMED_REFERENCE';
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

// ─── File Entries (DiffDetector) ─────────────────────────────

export type FileStatus = 'A' | 'M' | 'D' | 'full';

export interface FileEntry {
  filePath: string;
  status: FileStatus;
}

export interface DiffResult {
  toUpsert: FileEntry[];
  toDelete: FileEntry[];
}

// ─── Sync Engine ─────────────────────────────────────────────

export interface SyncConfig {
  repoPath: string;
  dbConnectionString: string;
}

export interface SyncRunResult {
  syncRunId: string;
  triggerType: 'cli_full' | 'cli_diff' | 'webhook';
  commitRange: string;
  filesProcessed: number;
  filesErrored: number;
  artifactsCreated: number;
  artifactsUpdated: number;
  artifactsDeleted: number;
  errors: Array<{ filePath: string; message: string }>;
  duration: number;
}

export interface ValidationReport {
  totalFiles: number;
  validFiles: number;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

// ─── Upsert Writer ───────────────────────────────────────────

export interface UpsertResult {
  stableId: string;
  action: 'created' | 'updated';
}

// ─── Error Log ───────────────────────────────────────────────

export interface ErrorLogEntry {
  file_path: string;
  error_code: string;
  message: string;
  timestamp: string;
}

// ─── Webhook ─────────────────────────────────────────────────

export interface WebhookPayload {
  ref: string;
  before: string;
  after: string;
  repository: {
    clone_url: string;
  };
}

export interface ServerConfig {
  port: number;
  allowedBranches: string[];
  repoWorkDir: string;
  dbConnectionString: string;
}

// ─── Generator ───────────────────────────────────────────────

export interface GeneratorConfig {
  outputPath: string;
  epics: number;
  storiesPerEpic: number;
  enablersPerEpic: number;
  reqsPerStory: number;
  crossCutting: number;
  evalsPerReq: number;
  milestones: number;
  releases: number;
  seed: number | null;
  gitHistory: boolean;
  malformed: number;
}

export interface GeneratorResult {
  outputPath: string;
  artifactCounts: Record<ArtifactType, number>;
  totalFiles: number;
  commits: number;
  malformedFiles: number;
}

export interface GeneratedArtifactStub {
  stableId: string;
  title: string;
  hierarchyNumber: string;
  parentStableId: string | null;
}

export type GeneratedArtifactMap = Map<ArtifactType, GeneratedArtifactStub[]>;

export interface LinkGraph {
  links: ArtifactLink[];
  getLinksFor(stableId: string): ArtifactLink[];
  getParent(stableId: string): string | null;
}

// ─── Git History Builder ──────────────────────────────────────

export interface StagedCommits {
  scaffold: string[];
  epicCommits: Map<string, string[]>;
  requirements: string[];
  crossCutting: string[];
  verification: string[];
  modifications: Array<{ path: string; content: string }>;
  deletions: string[];
  malformed: string[];
}

export interface CommitLog {
  commits: Array<{ sha: string; message: string; files: number }>;
}
