# Requirements Document

## Introduction
This specification defines the requirements for a Git-to-DB Sync PoC that proves a structured Markdown-based requirements repository can be reliably parsed and synchronized into a PostgreSQL database. The system comprises four deliverables: a sync engine (parser, validator, diff detector, upsert writer), a CLI tool (`reqsync`), a webhook server, and a test repository generator (`reqgen`). The database becomes a queryable, always-up-to-date mirror of the Git source of truth.

## Requirements

### Requirement 1: Markdown Artifact Parsing
**Objective:** As a developer, I want the sync engine to reliably extract structured data from all 16 artifact types, so that every artifact in the spec repo is representable as a database row.

#### Acceptance Criteria
1. When a Markdown file with a valid `## Identification` section is parsed, the Sync Engine shall extract the stable ID, hierarchy number, parent reference, and artifact type as structured fields.
2. When a Markdown file with a valid `## Metadata` section is parsed, the Sync Engine shall extract status, owner, priority, and all other key-value pairs into a metadata object.
3. When a Markdown file contains freeform sections (e.g., description, acceptance criteria, narrative), the Sync Engine shall capture the full Markdown body and preserve section-level structure.
4. When a Markdown file contains artifact ID references matching the pattern `(EPIC|US|EN|FR|NFR|BR|UC|ENT|API|SCR|ADR|AB|EV|RB|MS|REL)-\d{3}` in link-oriented sections, the Sync Engine shall extract each reference with its source section name as link-type context.
5. The Sync Engine shall extract the artifact title from the H1 heading of each Markdown file.
6. When a Markdown file belongs to any of the 16 artifact types (EPIC, US, EN, FR, NFR, BR, UC, ENT, API, SCR, ADR, EV, AB, RB, MS, REL), the Sync Engine shall parse it successfully using the same parsing pipeline.
7. When a file in a tracked directory is not a recognized artifact type (e.g., `vision.md`, `scope.md`, `glossary.md`), the Sync Engine shall skip it without producing an error.
8. When a traceability matrix file in `docs/13-traceability/` is encountered, the Sync Engine shall skip it and not create artifact rows for matrix content.

### Requirement 2: Git Diff Detection
**Objective:** As a developer, I want the sync engine to detect which files changed between commits, so that incremental syncs process only modified artifacts.

#### Acceptance Criteria
1. When a commit range is provided, the Diff Detector shall resolve the list of added, modified, and deleted Markdown files within tracked artifact directories.
2. When a file has git status `A` (added) or `M` (modified), the Diff Detector shall include it in the list of files to parse and upsert.
3. When a file has git status `D` (deleted), the Diff Detector shall include it in the list of files to soft-delete.
4. When a full sync is requested (no commit range), the Diff Detector shall walk the entire repository tree and return all Markdown files in tracked directories.
5. The Diff Detector shall ignore files outside the defined artifact directory paths.

### Requirement 3: Artifact Validation
**Objective:** As a developer, I want parsed artifacts to be validated before database insertion, so that data integrity issues are caught and logged without blocking valid artifacts.

#### Acceptance Criteria
1. When an artifact is parsed, the Validator shall verify that the stable ID in the file body matches the filename prefix.
2. When an artifact is missing required fields for its artifact type, the Validator shall log a validation error for that file.
3. When a referenced artifact ID does not follow the `PREFIX-NNN` format, the Validator shall log a warning.
4. When duplicate stable IDs are detected within a single sync batch, the Validator shall log an error for the duplicates.
5. If a file fails validation, the Sync Engine shall log the error in the sync run's error log and continue processing remaining files.
6. The Validator shall not block the sync of other valid artifacts when one file fails validation.

### Requirement 4: Database Schema and Storage
**Objective:** As a developer, I want a database schema that can represent all 16 artifact types with their fields and traceability links, so that the database serves as a complete queryable mirror.

#### Acceptance Criteria
1. The database schema shall include an `artifacts` table with columns for: id (UUID PK), stable_id (unique, indexed), artifact_type, hierarchy_number, title, status, owner, priority, parent_stable_id, metadata_json (JSONB), body_markdown, links_json (JSONB), file_path, source_commit_sha, synced_at, deleted_at, and created_at.
2. The database schema shall include a `sync_runs` table with columns for: id (UUID PK), trigger_type, commit_range, started_at, finished_at, files_processed, files_errored, artifacts_created, artifacts_updated, artifacts_deleted, and error_log (JSONB).
3. The database schema shall be defined as Drizzle ORM schema files and migrations shall be generated via Drizzle Kit.
4. The `stable_id` column in the `artifacts` table shall have a unique index to enforce one row per artifact.
5. The `metadata_json` column shall store all parsed key-value metadata fields as a JSONB object.
6. The `links_json` column shall store an array of objects, each containing `target_id`, `link_type`, and `section`.

### Requirement 5: Upsert and Sync Semantics
**Objective:** As a developer, I want the sync engine to correctly create, update, and soft-delete artifacts, so that the database always reflects the current state of the Git repository.

#### Acceptance Criteria
1. When an artifact's stable ID does not exist in the database, the Upsert Writer shall insert a new row.
2. When an artifact's stable ID already exists in the database and is not soft-deleted, the Upsert Writer shall update the metadata, body, links, commit SHA, and synced_at timestamp.
3. When a file is deleted from the repository (detected via git diff `D` status), the Upsert Writer shall set the `deleted_at` timestamp on the corresponding artifact row.
4. When the same commit range is synced twice, the Sync Engine shall produce identical database state with no duplicate rows and no lost updates (idempotency).
5. The Sync Engine shall execute each sync run within a single database transaction; if a system-level error occurs, the entire batch shall roll back.
6. When individual file parse failures occur within a transaction, the Sync Engine shall log them in the sync run's error_log but shall not abort the transaction for other files.
7. The Upsert Writer shall record the source commit SHA and file path on every artifact row for provenance tracking.
8. When a sync run completes, the Sync Engine shall create a `sync_runs` record with accurate counts of files processed, files errored, artifacts created, updated, and deleted.

### Requirement 6: CLI Tool (reqsync)
**Objective:** As a developer, I want a CLI tool to manually trigger syncs and inspect sync status, so that I can test and operate the sync pipeline from the command line.

#### Acceptance Criteria
1. When `reqsync sync full` is invoked with `--repo` and `--db` arguments, the CLI shall parse and upsert all artifact files from the repository into the database.
2. When `reqsync sync diff <range>` is invoked, the CLI shall parse and upsert only files changed within the specified commit range.
3. When `reqsync sync diff HEAD~1` is invoked, the CLI shall treat it as a shorthand for the last commit's changes.
4. When `reqsync validate` is invoked, the CLI shall parse all artifact files and report validation errors without writing to the database.
5. When `reqsync status` is invoked, the CLI shall display the summary of the last sync run from the database.
6. The CLI shall accept `--repo <path>` and `--db <postgres-connection-string>` as required configuration arguments.

### Requirement 7: Webhook Server
**Objective:** As a developer, I want a webhook endpoint that triggers syncs on git push events, so that the database stays up-to-date automatically when changes are pushed.

#### Acceptance Criteria
1. When a POST request is received at `/webhook/git` with a valid push event payload, the Webhook Server shall extract the commit range and trigger a diff-based sync.
2. When a push event is received, the Webhook Server shall return HTTP 202 Accepted immediately and execute the sync asynchronously.
3. When a GET request is received at `/status`, the Webhook Server shall return the summary of the last sync run.
4. The Webhook Server shall accept push events only for configurable branch(es), defaulting to `main`.
5. If the push event targets a non-configured branch, the Webhook Server shall ignore the event and return HTTP 200 OK with no sync triggered.
6. When triggered by a webhook, the Webhook Server shall clone or pull the repository to a local working directory before invoking the sync logic.

### Requirement 8: Test Repository Generator (reqgen)
**Objective:** As a developer, I want a CLI tool that generates realistic spec repositories with configurable scale, so that I can test the sync engine under varying conditions without hand-crafting seed files.

#### Acceptance Criteria
1. When `reqgen --output <path>` is invoked, the Generator shall create a complete spec repository following the defined directory structure for all 16 artifact types.
2. The Generator shall accept options for `--epics`, `--stories-per-epic`, `--enablers-per-epic`, `--reqs-per-story`, `--cross-cutting`, `--evals-per-req`, `--milestones`, and `--releases` to control repository scale.
3. When `--seed <int>` is provided, the Generator shall produce deterministic output — two runs with the same seed and options shall produce identical repository content.
4. The Generator shall assign sequential stable IDs per type (e.g., `EPIC-001`, `EPIC-002`) and compute hierarchy numbers from the parent-child structure.
5. The Generator shall create valid traceability links: every US and EN links to its parent EPIC, every FR links to its parent US or EN, and every EV links to its parent FR.
6. The Generator shall randomly assign cross-cutting artifacts (NFR, BR, UC, ENT, API, SCR, ADR, AB, RB) to 1–3 epics/stories/FRs to create a realistic link graph.
7. When `--git-history` is enabled (default), the Generator shall create a multi-commit Git repository with distinct commits for scaffolding, epics, requirements, cross-cutting artifacts, verification, modifications, and deletions.
8. When `--malformed <n>` is set, the Generator shall produce `n` files with common defects (missing Identification section, stable ID mismatch, missing required fields, duplicate stable IDs, garbled Markdown) in a dedicated commit.
9. The Generator shall produce traceability matrix files in `docs/13-traceability/` that are consistent with the generated artifact link graph.
10. The Generator shall produce static documentation files (`README.md`, `vision.md`, `scope.md`, `glossary.md`) with minimal placeholder content.

### Requirement 9: Dependency Ordering and Link Resolution
**Objective:** As a developer, I want artifacts to be processed in dependency order and links to be resolved accurately, so that parent references are valid and the traceability graph is correct.

#### Acceptance Criteria
1. When performing a full sync, the Sync Engine shall process files in dependency order where possible (epics before stories, stories before FRs) to ensure parent references resolve.
2. The Sync Engine shall store all extracted artifact ID references in the `links_json` column with their target ID, link type, and source section.
3. When acceptance criteria are found inline within an artifact file, the Sync Engine shall parse and store them as part of the parent artifact's body and metadata_json.

### Requirement 10: Normalized Artifact Links (Stretch)
**Objective:** As a developer, I want traceability links stored in a normalized table, so that relationship queries are efficient and typed.

#### Acceptance Criteria
1. Where the `artifact_links` feature is included, the database schema shall include an `artifact_links` table with columns for: id, source_stable_id, target_stable_id, link_type, and source_section.
2. Where the `artifact_links` feature is included, the Sync Engine shall populate the table by resolving `links_json` entries against known artifacts in a second pass after all artifacts are inserted.
3. If a link references a target stable ID that does not exist in the database (dangling reference), the Sync Engine shall log a warning and not insert the link into the `artifact_links` table.
