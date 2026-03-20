# Product

`git-db-sync` (CLI: `reqsync`) is a Git-to-PostgreSQL sync pipeline for structured Markdown artifact repositories.

It parses Markdown files that represent software engineering artifacts (epics, user stories, functional requirements, ADRs, etc.), validates them, and upserts them into a PostgreSQL database. Syncs can be triggered via CLI (full or incremental diff-based) or via a Git webhook server.

A companion CLI tool `reqgen` generates synthetic artifact repositories for testing and development.

## Core Concepts

- **Artifacts**: Markdown files with a stable ID (e.g. `FR-001`, `EPIC-003`) in a structured format with `Identification` and `Metadata` H2 sections.
- **Stable ID**: Unique identifier per artifact, format `PREFIX-NNN` (e.g. `US-042`). Determines artifact type.
- **Sync Run**: A recorded execution that tracks files processed, errors, and artifact counts.
- **Tracked Directories**: A fixed set of `docs/` subdirectories where artifacts live (defined in `TRACKED_DIRS`).
