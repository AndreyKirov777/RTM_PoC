# User Guide: RTM PoC — Git-to-Database Sync Pipeline

## Overview

This tool syncs a Git-based requirements repository to PostgreSQL. The repository is the source of truth; the database provides a queryable mirror for dashboards, traceability queries, and agent workflows.

Two CLI tools are included:

- **`reqsync`** — syncs and validates artifacts from a spec repo to the database
- **`reqgen`** — generates a test spec repository for development and testing

---

## Prerequisites

- Node.js 20+
- PostgreSQL 16
- A spec repository structured with the expected directory layout (see [Artifact Types](#artifact-types))

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure the database

```bash
export DATABASE_URL="postgres://user:password@localhost:5432/gitdbsync"
```

### 3. Run migrations

```bash
npm run db:generate   # Generate SQL from Drizzle schema
npm run db:migrate    # Apply migrations to the database
```

### 4. Build (optional for production)

```bash
npm run build
```

Or run directly in development mode with hot reload:

```bash
npm run dev
```

---

## `reqsync` — Sync CLI

### Usage

```
reqsync --repo <path> --db <postgres-url> <command>
```

### Global flags

| Flag | Description |
|------|-------------|
| `--repo <path>` | Path to the local spec Git repository |
| `--db <url>` | PostgreSQL connection string |

---

### Commands

#### `sync full`

Parses and upserts all artifacts found in the repository.

```bash
reqsync --repo ./spec-repo --db "postgres://..." sync full
```

Use this for the initial load or when you need to rebuild the database from scratch.

---

#### `sync diff <range>`

Syncs only the files that changed within a commit range. More efficient for CI/CD pipelines on incremental pushes.

```bash
reqsync --repo ./spec-repo --db "postgres://..." sync diff HEAD~1..HEAD
```

Any file that was deleted in the range is soft-deleted in the database (the row is kept with a `deleted_at` timestamp set).

---

#### `validate`

Parses all artifact files and reports validation errors without writing to the database. Useful for checking a PR before merge.

```bash
reqsync --repo ./spec-repo --db "postgres://..." validate
```

Validation checks:
- Stable ID matches the filename prefix (e.g., `FR-042` must be in a file starting with `FR-042`)
- All required fields are present for the artifact type
- No duplicate stable IDs within the batch

Warnings and errors are printed to stdout; the command exits with a non-zero status if any errors are found.

---

#### `status`

Displays a summary of the most recent sync run stored in the database.

```bash
reqsync --repo ./spec-repo --db "postgres://..." status
```

Output includes:
- Trigger type (`cli_full`, `cli_diff`, `webhook`)
- Commit range
- Start and finish time
- Counts: files processed, files errored, artifacts created/updated/deleted

---

## Webhook Server

The webhook server listens for Git push events and triggers an incremental sync automatically.

### Starting the server

```bash
npm run dev -- server --db "postgres://..." --repo ./spec-repo
```

### Endpoint

```
POST /webhook/git
```

Accepts GitHub or GitLab push event payloads. The server:
1. Extracts the commit range from the payload
2. Returns `202 Accepted` immediately
3. Runs `sync diff` asynchronously in the background

Only pushes to the configured allowed branches are processed (default: `main`).

### Health check

```
GET /status
```

Returns the last sync run summary (same as `reqsync status`).

---

## `reqgen` — Test Repository Generator

Generates a realistic spec repository for testing and development. Output is deterministic when a seed is provided.

### Usage

```bash
reqgen --output <path> [options]
```

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--output <path>` | required | Directory to write the generated repo |
| `--epics <n>` | `3` | Number of epics to generate |
| `--stories-per-epic <n>` | `4` | User stories per epic |
| `--enablers-per-epic <n>` | `1` | Enablers per epic |
| `--reqs-per-story <n>` | `2` | Functional requirements per story |
| `--cross-cutting <n>` | `2` | NFRs and business rules (shared) |
| `--evals-per-req <n>` | `1` | Eval scenarios per requirement |
| `--milestones <n>` | `1` | Number of milestones |
| `--releases <n>` | `1` | Number of release slices |
| `--seed <number>` | random | Seed for deterministic output |
| `--git-history` | false | Initialize a Git repo with multi-commit history |
| `--malformed <n>` | `0` | Number of intentionally malformed files to include |

### Example

```bash
reqgen --output ./test-repo \
  --epics 2 \
  --stories-per-epic 3 \
  --seed 42 \
  --git-history
```

The generated repository can be used directly with `reqsync`:

```bash
reqsync --repo ./test-repo --db "postgres://..." sync full
```

---

## Artifact Types

The sync pipeline handles 16 artifact types. Each type has a dedicated directory and filename prefix.

| Prefix | Type | Directory |
|--------|------|-----------|
| `EPIC` | Epic | `docs/01-roadmap/epics/` |
| `MS` | Milestone | `docs/01-roadmap/milestones/` |
| `REL` | Release Slice | `docs/01-roadmap/release-slices/` |
| `FR` | Functional Requirement | `docs/02-requirements/functional/` |
| `NFR` | Non-Functional Requirement | `docs/02-requirements/non-functional/` |
| `BR` | Business Rule | `docs/02-requirements/business-rules/` |
| `US` | User Story | `docs/03-delivery-backlog/user-stories/` |
| `EN` | Enabler | `docs/03-delivery-backlog/enablers/` |
| `UC` | Use Case | `docs/04-use-cases/` |
| `ENT` | Entity | `docs/05-domain-model/entities/` |
| `API` | API Endpoint | `docs/06-api/endpoints/` |
| `ADR` | Architecture Decision | `docs/07-architecture/adrs/` |
| `SCR` | Screen Spec | `docs/08-ux/screens/` |
| `AB` | Abuse Case | `docs/09-security/abuse-cases/` |
| `RB` | Runbook | `docs/10-operations/runbooks/` |
| `EV` | Eval Scenario | `docs/11-evals/scenarios/` |

Files not matching any recognized prefix (e.g., `README.md`, `vision.md`) are silently skipped.

---

## Artifact File Format

Each artifact is a Markdown file. The parser extracts structured data from it.

### Required elements

- **H1 heading** — becomes the artifact title
- **Stable ID** — must appear in an identification section and match the filename prefix (e.g., `FR-042-...md` must contain `FR-042`)

### Optional elements parsed

- `status`, `owner`, `priority` fields
- `parent:` reference to a parent artifact's stable ID
- Hierarchy number (e.g., `1.3.2`)
- Traceability links — any reference to another artifact ID (e.g., `[[FR-042]]` or inline mentions) is captured
- Acceptance criteria sections
- Arbitrary key-value metadata in the identification block (stored as JSONB)

---

## Database Schema

### `artifacts`

The primary table. Each row is one artifact.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `stable_id` | VARCHAR | Natural key, e.g., `FR-042` — unique |
| `artifact_type` | VARCHAR | One of the 16 types |
| `title` | TEXT | H1 heading |
| `status`, `owner`, `priority` | VARCHAR | Metadata fields |
| `parent_stable_id` | VARCHAR | Reference to parent artifact |
| `hierarchy_number` | VARCHAR | e.g., `1.3.2` |
| `metadata_json` | JSONB | Additional key-value fields |
| `body_markdown` | TEXT | Full Markdown content |
| `links_json` | JSONB | Array of `{targetId, linkType, section}` |
| `file_path` | TEXT | Path within the repository |
| `source_commit_sha` | TEXT | Commit that last modified the file |
| `synced_at` | TIMESTAMP | Last sync time |
| `deleted_at` | TIMESTAMP | Set on soft delete; `NULL` if active |

### `sync_runs`

Audit log for every sync operation.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `trigger_type` | VARCHAR | `cli_full`, `cli_diff`, or `webhook` |
| `commit_range` | VARCHAR | e.g., `HEAD~1..HEAD` or `full` |
| `started_at`, `finished_at` | TIMESTAMP | Execution window |
| `files_processed`, `files_errored` | INT | File counts |
| `artifacts_created`, `artifacts_updated`, `artifacts_deleted` | INT | Change counts |
| `error_log` | JSONB | Per-file errors |

---

## CI/CD Integration

A typical pipeline step for incremental sync on push to `main`:

```yaml
- name: Sync requirements to database
  run: |
    npx reqsync \
      --repo . \
      --db "$DATABASE_URL" \
      sync diff ${{ github.event.before }}..${{ github.sha }}
```

For pull request validation (no DB write):

```yaml
- name: Validate requirements
  run: |
    npx reqsync --repo . --db "$DATABASE_URL" validate
```

---

## Running Tests

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
```

Tests use Vitest and include unit tests for each pipeline component and an end-to-end integration test (`src/integration/sync-pipeline.test.ts`) that exercises the full sync flow.
