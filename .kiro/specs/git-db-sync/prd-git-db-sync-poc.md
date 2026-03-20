# PRD: Git → DB Sync PoC

## 1. Purpose

Prove that a structured Markdown-based requirements repository (the "spec repo") can be reliably parsed and synchronized into a PostgreSQL database, so that the DB becomes a queryable, always-up-to-date mirror of the Git source of truth.

This PoC validates the core pipeline before building higher-level features (UI, MCP server, traceability queries, agent workflows) on top of the database.

## 2. Background

The requirements management application treats a Git repository as the canonical store for all product specification artifacts. Each artifact is a Markdown file following a standardized template with structured frontmatter-style metadata sections (Identification, Metadata, Linked artifacts, etc.) and a stable ID–based naming convention.

The repository structure defines 16 artifact types organized across 14 top-level documentation sections, with explicit traceability links encoded directly in the files. To power search, dashboards, traceability graphs, and agent integrations, this content must be materialized into a relational database that stays in sync with the repo.

## 3. Goals

**Must prove:**

1. The Markdown parser can reliably extract structured data (identification block, metadata, freeform content, and linked artifact references) from all 16 artifact templates.
2. A `git push` or CLI invocation triggers a sync that correctly creates, updates, and soft-deletes artifacts in PostgreSQL.
3. The database schema can represent all 16 artifact types, their common and type-specific fields, and their traceability links (initially as stored references, with a stretch goal of normalized relationship tables).
4. Incremental sync works — only changed files are re-processed on subsequent runs.

**Non-goals for the PoC:**

- Web UI or API layer.
- DB → Git reverse sync or conflict resolution.
- Authentication, authorization, or multi-tenancy.
- Electronic signatures, baselines, or compliance audit trails.
- Performance optimization for large repositories (>1,000 artifacts).

## 4. Artifact Types in Scope

All 16 artifact types defined in the spec repo:

| Prefix | Artifact Type         | Folder Path                        |
|--------|-----------------------|------------------------------------|
| EPIC   | Epic                  | `docs/01-roadmap/epics/`           |
| US     | User Story            | `docs/03-delivery-backlog/user-stories/` |
| EN     | Enabler               | `docs/03-delivery-backlog/enablers/` |
| FR     | Functional Requirement| `docs/02-requirements/functional/` |
| NFR    | Non-Functional Req.   | `docs/02-requirements/non-functional/` |
| BR     | Business Rule         | `docs/02-requirements/business-rules/` |
| UC     | Use Case              | `docs/04-use-cases/`               |
| ENT    | Entity                | `docs/05-domain-model/entities/`   |
| API    | API Endpoint          | `docs/06-api/endpoints/`           |
| SCR    | Screen Spec           | `docs/08-ux/screens/`              |
| ADR    | Architecture Decision | `docs/07-architecture/adrs/`       |
| EV     | Eval Scenario         | `docs/11-evals/scenarios/`         |
| AB     | Abuse Case            | `docs/09-security/abuse-cases/`    |
| RB     | Runbook               | `docs/10-operations/runbooks/`     |
| MS     | Milestone             | `docs/01-roadmap/milestones/`      |
| REL    | Release Slice         | `docs/01-roadmap/release-slices/`  |

## 5. Sync Triggers

| Trigger       | Mechanism                         | PoC Scope |
|---------------|-----------------------------------|-----------|
| Git webhook   | HTTP endpoint receives push/merge events, triggers sync for changed files | Yes |
| CLI command   | Manual invocation: `sync --repo <path> [--full | --diff <commit-range>]` | Yes |
| Periodic poll | Cron-based pull + sync            | No        |

The CLI is the primary development and testing interface. The webhook handler is a thin HTTP wrapper around the same sync logic.

## 6. High-Level Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌────────────────┐
│   Git Repo      │────▶│   Sync Engine    │────▶│  PostgreSQL    │
│  (source of     │     │                  │     │                │
│   truth)        │     │  1. Diff detect  │     │  - artifacts   │
└─────────────────┘     │  2. MD parse     │     │  - links (JSON)│
        ▲               │  3. Validate     │     │  - sync_log    │
        │               │  4. Upsert       │     └────────────────┘
  push / merge          └──────────────────┘
        │                       ▲
  ┌─────┴──────┐          ┌─────┴──────┐
  │  Webhook   │          │    CLI     │
  │  Endpoint  │          │            │
  └────────────┘          └────────────┘
```

### Components

**Diff Detector** — Given a commit range (from webhook payload or CLI arg), resolves the list of added/modified/deleted Markdown files in tracked directories. For full sync, walks the entire tree.

**Markdown Parser** — Extracts structured data from each artifact file:
- Stable ID and artifact type (from filename and Identification section).
- Hierarchy number, parent references, status, owner, priority (from Identification and Metadata sections).
- Traceability links — all `XX-NNN` references found in Linked artifacts / Related artifacts / Traceability sections.
- Raw Markdown body for freeform sections (epic summary, user story text, acceptance criteria, etc.).

**Validator** — Checks parsed output for:
- Stable ID matches filename prefix.
- Required fields present per artifact type.
- Referenced artifact IDs follow the `PREFIX-NNN` format.
- No duplicate stable IDs in a single sync batch.

Validation errors are logged but do not block the sync of other valid artifacts (fail-open per file, not per batch).

**Upsert Writer** — Inserts or updates rows in the database. Uses the stable ID as the natural key. Tracks the source commit SHA and file path for provenance. Marks artifacts as deleted (soft delete) if their files are removed from the repo.

## 7. Database Schema (Conceptual)

All tables are defined as Drizzle ORM schema files (`src/db/schema/`). The tables below describe the target structure; Drizzle Kit generates and applies migrations from the schema definitions.

### Core table: `artifacts`

| Column              | Type        | Notes                                      |
|---------------------|-------------|--------------------------------------------|
| `id`                | UUID (PK)   | Internal surrogate key                     |
| `stable_id`         | VARCHAR     | `EPIC-001`, `FR-007`, etc. Unique, indexed |
| `artifact_type`     | VARCHAR     | Enum: `EPIC`, `US`, `EN`, `FR`, ...       |
| `hierarchy_number`  | VARCHAR     | `1.3.R2` — nullable for cross-cutting types|
| `title`             | TEXT        | Name extracted from H1 heading             |
| `status`            | VARCHAR     | `Draft`, `Approved`, `In Progress`, etc.   |
| `owner`             | VARCHAR     | Nullable                                   |
| `priority`          | VARCHAR     | Nullable                                   |
| `parent_stable_id`  | VARCHAR     | Direct parent reference (e.g., EPIC for US)|
| `metadata_json`     | JSONB       | All parsed key-value metadata fields       |
| `body_markdown`     | TEXT        | Full Markdown body for freeform content    |
| `links_json`        | JSONB       | Array of `{target_id, link_type, section}` |
| `file_path`         | VARCHAR     | Relative path in repo                      |
| `source_commit_sha` | VARCHAR     | Commit that last modified this artifact    |
| `synced_at`         | TIMESTAMPTZ | Last sync timestamp                        |
| `deleted_at`        | TIMESTAMPTZ | Soft-delete marker, null if active         |
| `created_at`        | TIMESTAMPTZ | First sync timestamp                       |

### Sync log table: `sync_runs`

| Column            | Type        | Notes                              |
|-------------------|-------------|------------------------------------|
| `id`              | UUID (PK)   |                                    |
| `trigger_type`    | VARCHAR     | `webhook`, `cli_full`, `cli_diff`  |
| `commit_range`    | VARCHAR     | `abc123..def456` or `full`         |
| `started_at`      | TIMESTAMPTZ |                                    |
| `finished_at`     | TIMESTAMPTZ |                                    |
| `files_processed` | INTEGER     |                                    |
| `files_errored`   | INTEGER     |                                    |
| `artifacts_created`| INTEGER    |                                    |
| `artifacts_updated`| INTEGER    |                                    |
| `artifacts_deleted`| INTEGER    |                                    |
| `error_log`       | JSONB       | Per-file error details             |

### Stretch goal: `artifact_links` (normalized)

| Column            | Type    | Notes                                    |
|-------------------|---------|------------------------------------------|
| `id`              | UUID    |                                          |
| `source_stable_id`| VARCHAR | FK to `artifacts.stable_id`              |
| `target_stable_id`| VARCHAR | FK to `artifacts.stable_id`              |
| `link_type`       | VARCHAR | `parent`, `implements`, `verifies`, `linked_nfr`, `linked_api`, etc. |
| `source_section`  | VARCHAR | Which section of the source file declared this link |

This table would be populated by resolving the `links_json` entries against known artifacts. Dangling references (target not yet synced) are logged but not inserted.

## 8. Markdown Parsing Strategy

The templates use a consistent structure:

```markdown
# PREFIX-NNN: Title

## Identification
- Stable ID: PREFIX-NNN
- Hierarchy No.: X.Y.Z
- Parent: PREFIX-NNN
- Artifact Type: <Type>

## Metadata
- Status: Draft
- Owner: ...
- Priority: ...

## <Freeform sections>
...

## Linked artifacts / Related artifacts / Traceability
- FR-...
- NFR-...
```

**Parsing approach:**

1. Split file into H2 sections.
2. Parse `Identification` and `Metadata` sections as key-value pairs (line starts with `- Key: Value`).
3. Scan all sections for stable ID references matching `(EPIC|US|EN|FR|NFR|BR|UC|ENT|API|SCR|ADR|AB|EV|RB|MS|REL)-\d{3}` regex pattern.
4. Capture artifact ID references specifically from link-oriented sections (`Linked artifacts`, `Related artifacts`, `Traceability`, `Linked requirements`, `Verification`, etc.) and tag them with the section name as the `link_type` context.
5. Store the full Markdown body and section-level breakdown for rich content retrieval later.

**Edge cases to handle:**

- Acceptance criteria are inline within user story / FR files, not separate files — parse and store as part of the parent artifact's body and metadata.
- Traceability matrix files (`docs/13-traceability/`) are tables, not individual artifacts — parse as a special case to cross-validate links but do not create artifact rows.
- Non-artifact Markdown files (`vision.md`, `scope.md`, `glossary.md`, etc.) — skip during sync, or optionally store as `DOC` type artifacts for full-text search.

## 9. Sync Semantics

**Upsert rule:** `stable_id` is the match key.
- If stable ID exists in DB and is not soft-deleted → UPDATE metadata, body, links, commit SHA, synced_at.
- If stable ID does not exist → INSERT.
- If a file is deleted from repo (detected via git diff `D` status) → SET `deleted_at = now()`.

**Idempotency:** Running the same commit range twice produces the same DB state (no duplicates, no lost updates).

**Atomicity:** Each sync run executes within a single database transaction. If any system-level error occurs, the entire batch rolls back. Individual file parse failures are logged in the sync run's `error_log` but do not abort the transaction for other files.

**Ordering:** Files are processed in dependency order where possible (epics before stories, stories before FRs) to ensure parent references resolve. For the stretch goal `artifact_links` table, a second pass resolves references after all artifacts are inserted.

## 10. CLI Interface

```
reqsync --repo <path-to-repo> --db <postgres-connection-string>

Commands:
  sync full          Parse and upsert all artifact files
  sync diff <range>  Parse and upsert only files changed in commit range
  sync diff HEAD~1   Shorthand for last commit
  validate           Parse all files and report errors without writing to DB
  status             Show last sync run summary
```

## 11. Webhook Interface

Minimal HTTP server (single endpoint):

```
POST /webhook/git
Content-Type: application/json

{
  "ref": "refs/heads/main",
  "before": "abc123",
  "after": "def456",
  "repository": { "clone_url": "..." }
}
```

Behavior:
- Accept push events for configurable branch(es) (default: `main`).
- Extract commit range from payload.
- Clone/pull repo to local working directory.
- Invoke the same sync logic as `sync diff`.
- Return `202 Accepted` immediately; sync runs asynchronously.
- Expose `GET /status` returning the last sync run summary.

## 12. Test Repository Generator

A CLI tool that generates a realistic spec repository with configurable scale and shape, initialized as a Git repo with commit history. This replaces hand-crafted seed files and enables repeatable testing of the sync engine under varying conditions.

### CLI Interface

```
reqgen --output <path>

Options:
  --epics <n>             Number of epics (default: 3)
  --stories-per-epic <n>  Stories per epic (default: 4)
  --enablers-per-epic <n> Enablers per epic (default: 1)
  --reqs-per-story <n>    FRs per story/enabler (default: 2)
  --cross-cutting <n>     Number of each cross-cutting type: NFR, BR, UC,
                          ENT, API, SCR, ADR, AB, RB (default: 2)
  --evals-per-req <n>     EV scenarios per FR (default: 1)
  --milestones <n>        Number of milestones (default: 1)
  --releases <n>          Number of release slices (default: 1)
  --seed <int>            Random seed for reproducible generation
  --git-history           Initialize as Git repo with multi-commit history
                          (default: true)
  --malformed <n>         Inject n intentionally malformed files for
                          error-handling tests (default: 0)
```

### Generation Rules

**Identity and naming:**
- Stable IDs are assigned sequentially per type (`EPIC-001`, `EPIC-002`, ...).
- Hierarchy numbers are computed from the parent-child structure.
- Filenames follow the `PREFIX-NNN-<slug>.md` convention with generated slugs (e.g., `FR-007-persist-session-data.md`).

**Content generation:**
- Each file is rendered from the corresponding template with placeholder content that is realistic enough to exercise the parser — populated key-value fields, multi-line freeform sections, and inline acceptance criteria with hierarchy-numbered IDs.
- Content can be deterministic (seeded random) or use an LLM call for more realistic text (opt-in, not required for PoC).

**Traceability links:**
- Every US and EN links back to its parent EPIC.
- Every FR links to its parent US or EN.
- Every EV links to its parent FR and acceptance criterion.
- Cross-cutting artifacts (NFR, BR, UC, ENT, API, SCR, ADR, AB, RB) are randomly assigned to 1–3 epics/stories/FRs to create a realistic link graph.
- A configurable percentage of links are intentionally dangling (reference non-existent IDs) for testing link validation.

**Traceability matrices:**
- `docs/13-traceability/epic-story-matrix.md`, `requirements-matrix.md`, and `verification-matrix.md` are generated from the link graph to match the actual artifact files.

**Static docs:**
- `README.md`, `AGENTS.md`, `vision.md`, `scope.md`, `glossary.md`, and other non-artifact Markdown files are generated with minimal placeholder content.

**Directory structure:**
- Output follows the full `product-spec/` layout defined in the repo spec, with files placed in their correct folders.

### Git History Simulation

When `--git-history` is enabled, the generator creates a multi-commit repo that exercises the diff-based sync path:

1. **Initial commit** — scaffold with `README.md`, `AGENTS.md`, static docs, and templates.
2. **Epic commits** — one commit per epic, adding the epic file and its child stories/enablers.
3. **Requirements commit** — bulk-add all FR, NFR, BR files.
4. **Cross-cutting commit** — add UC, ENT, API, SCR, ADR, AB, RB files.
5. **Verification commit** — add EV files and traceability matrices.
6. **Modification commit** — update 2–3 existing artifacts (change status, add links) to produce non-trivial diffs.
7. **Deletion commit** — remove 1–2 artifacts to test soft-delete sync.

Each commit has a descriptive message (e.g., `"Add EPIC-001 and child stories US-001..US-004"`). This gives a usable commit range for `sync diff` testing without manual setup.

### Malformed File Injection

When `--malformed <n>` is set, the generator produces `n` files with common defects:

- Missing `## Identification` section entirely.
- Stable ID in filename doesn't match stable ID in file body.
- Missing required fields (e.g., no `Status` in Metadata).
- Duplicate stable ID (same ID used in two different files).
- Garbled Markdown (unclosed code blocks, broken table syntax).

These files are added in a dedicated commit (`"Add malformed test artifacts"`) so they can be isolated in diff-based testing.

## 13. Technology Choices

| Component       | Choice        | Rationale                                |
|-----------------|---------------|------------------------------------------|
| Language        | TypeScript 5+ (Node.js 20+) | Consistent with future MCP server and web UI stack |
| Database        | PostgreSQL 16  | JSONB for flexible metadata, strong indexing |
| ORM             | Drizzle ORM   | Type-safe schema-as-code, lightweight, native JSONB support, push-based migrations |
| Git interaction | `simple-git`  | Promise-based wrapper over git CLI; diff detection, log, file listing |
| MD parsing      | `unified` / `remark` ecosystem or regex-based custom parser | Templates are structured enough for targeted extraction; remark gives AST access if needed |
| HTTP server     | Fastify (minimal) | Webhook endpoint only; lightweight, good TypeScript support |
| Migrations      | Drizzle Kit (`drizzle-kit push` / `generate`) | Schema-driven, no manual SQL files |
| Repo generation | Handlebars templates + `simple-git` | Render artifact files from templates; build commit history programmatically |

## 14. Success Criteria

| # | Criterion | How to Verify |
|---|-----------|---------------|
| 1 | All 16 artifact types parse correctly from their templates | Generate repo with `reqgen --epics 2`; `validate` reports zero errors |
| 2 | `sync full` populates DB with correct artifact count, types, and links | Query counts match file counts; spot-check 3–5 artifacts for field accuracy |
| 3 | `sync diff` processes only changed files | Modify 2 files, add 1, delete 1; verify exactly 4 DB operations in sync log |
| 4 | Soft delete works | Remove a file from repo, sync; verify `deleted_at` is set, artifact still queryable |
| 5 | Idempotency holds | Run `sync full` twice on same commit; verify no duplicate rows, same `synced_at` on second run |
| 6 | Traceability links are captured | Query `links_json` for an FR; verify it references its parent US and linked NFRs |
| 7 | Webhook triggers sync | POST sample GitHub/GitLab payload; verify sync run completes |
| 8 | Parse errors are non-fatal | Generate repo with `--malformed 3`; verify other artifacts sync, errors logged |

**Generator criteria:**

| # | Criterion | How to Verify |
|---|-----------|---------------|
| 9 | Generator produces valid repo structure | Generated repo matches expected directory layout for all 16 artifact types |
| 10 | Generated links are internally consistent | Every parent reference in a child artifact points to an artifact that exists in the generated repo |
| 11 | Git history is usable for diff sync | `git log --oneline` shows distinct commits; `sync diff HEAD~2..HEAD` processes only the last two commits' changes |
| 12 | Deterministic output with seed | Two runs with same `--seed` produce identical repo content |

**Stretch criteria:**

| # | Criterion | How to Verify |
|---|-----------|---------------|
| S1 | `artifact_links` table populated | Query for all links where source = `FR-001`; returns typed relationships |
| S2 | Dangling link detection | Reference `FR-999` (doesn't exist); verify it appears in error/warning log |
| S3 | Hierarchy number validation | Hierarchy numbers are consistent with parent-child structure |

## 15. Risks and Open Questions

| Risk / Question | Impact | Mitigation |
|-----------------|--------|------------|
| Template variations — real artifacts may deviate from templates | Parser breaks or loses data | Build parser against actual content, not just templates; use fuzzy section matching |
| Large diffs on branch merges could include hundreds of files | Sync timeout or memory issues | Out of scope for PoC; note as future concern |
| Acceptance criteria don't have their own files | Can't be individually addressable in DB | Store as structured JSON within parent artifact's `metadata_json`; evaluate if they need promotion to rows later |
| Traceability matrix files are tables, not artifacts | Unclear how to sync | Parse for cross-validation only; do not create artifact rows |
| Hierarchy numbers change when backlog is reshuffled | Stale hierarchy numbers in DB | Hierarchy numbers are overwritten on every sync — no caching issues |

## 16. Deliverables

1. **Sync engine** — TypeScript package with parser, validator, diff detector, and DB writer.
2. **CLI tool** — `reqsync` command with `sync full`, `sync diff`, `validate`, and `status` subcommands.
3. **Webhook server** — Single-file Fastify app with `/webhook/git` and `/status` endpoints.
4. **DB schema** — Drizzle ORM schema definitions for `artifacts`, `sync_runs`, and (stretch) `artifact_links` tables, with `drizzle-kit` migrations.
5. **Test repo generator** — `reqgen` CLI that produces a complete spec repo with configurable scale, valid traceability links, Git history, and optional malformed files.
6. **Test suite** — Unit tests for parser per artifact type; integration tests for sync lifecycle using generator output.
