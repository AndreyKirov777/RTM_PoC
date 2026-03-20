# Project Structure

```
src/
  cli/          # CLI entry points (reqsync.ts, reqgen.ts) — not covered by tests
  db/           # Drizzle schema (schema.ts) and DB connection factory (connection.ts)
  parser/       # MarkdownParser — parses artifact .md files into ParsedArtifact
  sync/         # Core sync pipeline components:
    diff-detector.ts    # Finds changed/all artifact files via git or fs
    validator.ts        # Validates ParsedArtifact (stable ID, required fields, duplicates)
    upsert-writer.ts    # Writes artifacts to DB (upsert + soft-delete)
    link-resolver.ts    # Resolves artifact links
    sync-engine.ts      # Orchestrates full/diff/validate-only sync runs
  server/       # Fastify webhook server (POST /webhook/git, GET /status)
  generator/    # reqgen: generates synthetic artifact repos with git history
  types.ts      # All shared domain types, constants, and Result<T,E> helpers
```

## Conventions

- All shared types live in `src/types.ts` — no inline type definitions scattered across modules
- Use the `Result<T, E>` / `Ok()` / `Err()` pattern for fallible operations (no thrown errors in parser/validator)
- Classes are used for stateful components (`MarkdownParser`, `SyncEngine`, `Validator`, `UpsertWriter`, `DiffDetector`)
- Test files co-located with source: `foo.ts` → `foo.test.ts`
- CLI files are excluded from test coverage
- DB schema inferred types exported from `schema.ts` (`ArtifactRow`, `SyncRunInsert`, etc.)
- Dependency injection via constructor options (e.g. `SyncEngine` accepts `mockOptions` for test isolation — no real DB or FS needed in unit tests)
- Artifact processing order follows `ARTIFACT_TYPE_ORDER` (parents before children)
- Soft-delete pattern: `deletedAt` timestamp on artifacts, never hard-delete
