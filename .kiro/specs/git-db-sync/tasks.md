# Implementation Plan

- [x] 1. Project setup and shared domain types
- [x] 1.1 Initialize the TypeScript project with ESM modules, all runtime and dev dependencies, and build/test tooling
  - Set up a Node.js 20+ project with TypeScript 5.x in strict mode and ESM module resolution
  - Install all runtime libraries specified in the technology stack (Commander.js, Fastify, Drizzle ORM, pg, simple-git, unified, remark-parse, unist-util-visit, mdast-util-to-string, Handlebars, seedrandom)
  - Install dev tooling: Vitest for testing, tsx for development execution, tsup for bundling, Drizzle Kit for migrations
  - Configure TypeScript strict mode, ESM output, and development scripts (dev, build, test, db:generate)
  - _Requirements: 4.3_

- [x] 1.2 Define the shared domain types and constants used across all components
  - Define the artifact type enumeration for all 16 types (EPIC, US, EN, FR, NFR, BR, UC, ENT, API, SCR, ADR, EV, AB, RB, MS, REL)
  - Define the stable ID regex pattern matching the PREFIX-NNN format
  - Define the list of tracked artifact directories that the diff detector uses to filter relevant files
  - Define the artifact type processing order for dependency-ordered sync (epics before stories, stories before FRs, etc.)
  - Define shared data structures for parsed artifacts, artifact links, file entries, diff results, and validation results
  - Define a Result type for explicit success/error returns from parsing and validation
  - _Requirements: 1.4, 1.6, 2.5, 9.1_

- [x] 2. Database schema and connection setup
- [x] 2.1 Define all database tables using Drizzle ORM schema-as-code
  - Define the artifacts table with all required columns: surrogate UUID key, unique stable_id, artifact_type, hierarchy_number, title, status, owner, priority, parent_stable_id, JSONB metadata, body_markdown, JSONB links array, file_path, source_commit_sha, synced_at, deleted_at, and created_at
  - Define the sync_runs table with: UUID key, trigger_type, commit_range, started_at, finished_at, processing counts (files processed, errored, artifacts created, updated, deleted), and JSONB error log
  - Define the artifact_links table (stretch) with: UUID key, source_stable_id, target_stable_id, link_type, and source_section
  - Add unique index on stable_id, regular indexes on artifact_type, deleted_at, and started_at (descending)
  - Set appropriate JSONB defaults: empty object for metadata, empty array for links and error log
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 10.1_

- [x] 2.2 Set up the database connection layer and generate the initial migration
  - Create a connection factory that accepts a PostgreSQL connection string and returns a configured database client
  - Generate the initial SQL migration from the schema definitions
  - Verify the migration creates all tables, indexes, and constraints correctly
  - _Requirements: 4.3_

- [x] 3. Markdown artifact parser
- [x] 3.1 (P) Build the core parser that extracts structured data from Markdown artifact files
  - Parse Markdown content into an AST using the unified/remark pipeline
  - Extract the artifact title from the first H1 heading
  - Extract stable ID, hierarchy number, parent reference, and artifact type from the Identification section
  - Extract status, owner, priority, and all other key-value pairs from the Metadata section into a metadata object
  - Capture the full Markdown body and preserve section-level structure in a sections map
  - _Requirements: 1.1, 1.2, 1.3, 1.5_

- [x] 3.2 Add link reference extraction and inline acceptance criteria parsing
  - Scan link-oriented sections for artifact ID references matching the stable ID pattern
  - Extract each reference with its source section name as link-type context
  - Parse inline acceptance criteria found within artifact files and store them as structured entries in the metadata
  - _Requirements: 1.4, 9.3_

- [x] 3.3 Handle artifact type inference and non-artifact file graceful skipping
  - Infer the artifact type from the stable ID prefix extracted during parsing
  - When a file does not match any of the 16 known type prefixes, return an error that callers treat as a skip without logging a failure
  - Ensure all 16 artifact types flow through the same parsing pipeline with no type-specific branching
  - _Requirements: 1.6, 1.7_

- [x] 3.4 Write unit tests for the parser covering all 16 artifact types and edge cases
  - Create sample Markdown files for each artifact type with realistic structured content
  - Verify correct extraction of identification fields, metadata, body, links, and title
  - Test edge cases: missing sections, empty fields, code blocks containing heading markers, files without an Identification section
  - Verify non-artifact files produce a skip-friendly error
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 9.3_

- [x] 4. Git diff detector
- [x] 4.1 (P) Implement diff-based file resolution for incremental sync
  - Execute a git diff with name-status output for the given commit range
  - Parse the output to classify files as added, modified, or deleted
  - Filter results to include only Markdown files within tracked artifact directories, excluding traceability matrix directories
  - Return separate lists for files to upsert (added/modified) and files to soft-delete (deleted)
  - _Requirements: 1.8, 2.1, 2.2, 2.3, 2.5_

- [x] 4.2 Implement full tree walk for complete repository scanning
  - Walk all tracked artifact directories and collect every Markdown file path
  - Exclude files outside tracked directories
  - Return all collected files marked with a full-sync status
  - _Requirements: 2.4, 2.5_

- [x] 5. Artifact validator
- [x] 5.1 (P) Implement per-artifact validation rules for data integrity checking
  - Verify that the stable ID in the file body matches the expected prefix derived from the filename
  - Check that all required fields for the artifact's type are present, with a configurable required-fields map per type
  - Warn when artifact ID references do not follow the PREFIX-NNN format
  - Return a result with errors and warnings without throwing exceptions
  - _Requirements: 3.1, 3.2, 3.3_

- [x] 5.2 Add batch validation for duplicate stable ID detection across a sync run
  - Accept a collection of parsed artifacts and detect duplicate stable IDs within the batch
  - Log an error for each duplicate occurrence with the conflicting file paths
  - Ensure individual validation failures do not block processing of other valid artifacts
  - _Requirements: 3.4, 3.5, 3.6_

- [x] 6. Upsert writer
- [x] 6.1 (P) Implement artifact upsert with conflict resolution on stable ID
  - When an artifact's stable ID does not exist, insert a new row with all fields populated
  - When an artifact's stable ID already exists, update metadata, body, links, commit SHA, and sync timestamp
  - Store extracted artifact links as a structured JSONB array
  - Ensure re-syncing the same commit range produces identical database state (idempotency)
  - _Requirements: 5.1, 5.2, 5.4, 9.2_

- [x] 6.2 Implement soft-delete for removed artifacts and provenance tracking
  - Set the deleted_at timestamp on artifact rows whose files were detected as deleted
  - Record the source commit SHA and file path on every artifact write for provenance
  - Accept a batch of stable IDs to soft-delete within the current transaction
  - _Requirements: 5.3, 5.7_

- [x] 7. Sync engine orchestration
- [x] 7.1 Wire the full sync pipeline within a single database transaction
  - Open a database transaction at the start of each sync run
  - Invoke the diff detector or full tree walker to determine which files to process
  - For each file to upsert: read its content, parse it, validate it, and upsert the artifact
  - For each deleted file: soft-delete the corresponding artifact row
  - Roll back the entire transaction on system-level errors (database connection loss, unexpected failures)
  - _Requirements: 5.5_

- [x] 7.2 Add dependency-order processing and per-file error isolation
  - Sort files for processing according to the artifact type order so that parent artifacts are upserted before children
  - Wrap each file's parse-validate-upsert cycle in isolated error handling that logs failures without aborting the transaction
  - Accumulate per-file errors for inclusion in the sync run's error log
  - _Requirements: 5.6, 9.1_

- [x] 7.3 Record sync run results with accurate counts and error details
  - Create a sync run record at the start of each execution with trigger type and commit range
  - Track running counts of files processed, files errored, artifacts created, updated, and deleted
  - Update the sync run record upon completion with final counts, error log, and finished timestamp
  - Support full sync, diff sync, and webhook trigger types
  - _Requirements: 5.8_

- [x] 8. CLI tool (reqsync)
- [x] 8.1 (P) Implement the sync full and sync diff commands with required global options
  - Set up the CLI framework with required global options for repository path and database connection string
  - Implement the full sync command that triggers a complete parse-and-upsert of all artifact files
  - Implement the diff sync command that accepts a commit range and processes only changed files
  - Handle the HEAD~1 shorthand as the last commit's changes
  - Format and print the sync run result summary to the terminal
  - Exit with code 0 on success, 1 on error
  - _Requirements: 6.1, 6.2, 6.3, 6.6_

- [x] 8.2 Implement the validate and status commands
  - Implement a validate command that parses all artifact files and reports validation errors without writing to the database
  - Implement a status command that queries and displays the most recent sync run summary from the database
  - Format validation errors and status output for clear, readable terminal display
  - _Requirements: 6.4, 6.5_

- [x] 9. Webhook server
- [x] 9.1 (P) Implement the webhook endpoint with branch filtering and async sync dispatch
  - Create an HTTP server with a POST endpoint for receiving git push event payloads
  - Extract the branch name from the payload and check it against the configurable allowed branches list (default: main)
  - Return an accepted response immediately and dispatch the sync asynchronously
  - When the push targets a non-configured branch, return a success response with no sync triggered
  - Reject malformed payloads with an appropriate error response
  - _Requirements: 7.1, 7.2, 7.4, 7.5_

- [x] 9.2 Implement the status endpoint and repository management
  - Add a status endpoint that returns the most recent sync run summary from the database
  - Return a not-found response when no sync runs exist yet
  - On first webhook: clone the repository to a local working directory; on subsequent webhooks: pull updates before syncing
  - Accept server configuration for port, allowed branches, repository work directory, and database connection
  - _Requirements: 7.3, 7.6_

- [x] 10. Test repository generator (reqgen)
- [x] 10.1 (P) Build the core artifact generation engine with templates and deterministic output
  - Create content templates for all 16 artifact types with realistic structured Markdown
  - Assign sequential stable IDs per type (EPIC-001, EPIC-002, FR-001, etc.) and compute hierarchy numbers from the parent-child structure
  - Use a seeded pseudo-random number generator for all random decisions so that identical seeds produce identical output
  - Generate the complete directory structure following the specification repository layout for all artifact types
  - _Requirements: 8.1, 8.3, 8.4_

- [x] 10.2 (P) Build the traceability link graph for parent-child and cross-cutting relationships
  - Create parent-child links: every user story and enabler links to its parent epic, every functional requirement links to its parent story or enabler, every evaluation links to its parent requirement
  - Randomly assign cross-cutting artifacts (non-functional requirements, business rules, use cases, entities, API endpoints, screens, ADRs, abuse cases, runbooks) to 1–3 parent artifacts using the seeded RNG
  - Make the link data available to both artifact content generation and traceability matrix generation
  - _Requirements: 8.5, 8.6_

- [x] 10.3 Build multi-commit git history simulating realistic project evolution
  - Initialize a git repository at the output path
  - Create distinct commits for: scaffolding, epics, requirements, cross-cutting artifacts, verification artifacts, modifications of existing artifacts, and deletions of selected artifacts
  - In the modifications commit, update 2–3 existing artifacts with changed content; in the deletions commit, remove 1–2 artifacts
  - Skip git history creation when the corresponding flag is disabled
  - _Requirements: 8.7_

- [x] 10.4 Add the CLI interface, malformed file injection, and auxiliary output generators
  - Set up the CLI with options for output path, scale parameters (epics, stories per epic, enablers, requirements per story, cross-cutting count, evals per requirement, milestones, releases), seed, git history toggle, and malformed file count
  - When malformed count is specified, inject files with defects: missing Identification section, stable ID mismatch, missing required fields, duplicate stable IDs, and garbled Markdown
  - Generate traceability matrix files consistent with the artifact link graph
  - Generate static documentation files (README, vision, scope, glossary) with placeholder content
  - _Requirements: 8.2, 8.8, 8.9, 8.10_

- [x] 11. Normalized artifact links (stretch)
- [x] 11.1 Implement second-pass link resolution to populate the normalized links table
  - After all artifacts are upserted in a sync run, resolve each artifact's link entries against known artifact rows in the database
  - Insert valid links with source ID, target ID, link type, and source section
  - _Requirements: 10.2_

- [x] 11.2 Add dangling reference detection and warning logging
  - When a link references a target stable ID that does not exist in the database, log a warning instead of inserting
  - Do not create link rows for dangling references
  - Include dangling reference counts in the sync run results
  - _Requirements: 10.3_

- [x] 12. Integration and E2E testing
- [x] 12.1 (P) Write integration tests for full sync, diff sync, and idempotency
  - Generate a test repository → run full sync → verify the artifact count in the database matches the file count and spot-check several artifacts for field accuracy
  - Full sync → modify two files, add one, delete one → diff sync → verify exactly the expected create, update, and delete operations in the sync run record
  - Run full sync twice on the same commit → verify no duplicate rows and identical sync timestamps (idempotency)
  - _Requirements: 5.4, 5.8_

- [x] 12.2 (P) Write integration tests for error isolation and webhook dispatch
  - Generate a repository with malformed files → sync → verify valid artifacts are synced, errors are logged, and the error count matches the malformed file count
  - POST a push payload to the webhook → verify a sync run is created and the accepted response is returned
  - POST a payload for a non-configured branch → verify no sync is triggered and a success response is returned
  - _Requirements: 3.5, 3.6, 7.1, 7.2, 7.5_

- [x] 12.3 (P) Write E2E tests for CLI workflows and generator determinism
  - Generate a repository with a fixed seed → full sync via CLI → check status via CLI → verify the summary matches expected artifact counts
  - Generate a repository twice with the same seed and options → compare the outputs → verify identical content
  - Run the validate command on a repository containing malformed files → verify errors are reported without any database writes
  - _Requirements: 6.1, 6.4, 6.5, 8.3_
