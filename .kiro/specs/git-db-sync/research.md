# Research & Design Decisions: git-db-sync

## Summary
- **Feature**: `git-db-sync`
- **Discovery Scope**: New Feature (greenfield)
- **Key Findings**:
  - Drizzle ORM provides native `onConflictDoUpdate` with `excluded` reference for batch upserts on unique keys — maps directly to the upsert-on-`stable_id` requirement.
  - `simple-git` exposes `diffSummary` and `raw` methods for commit-range diffs; file status (A/M/D) requires `diff --name-status` via `raw()`.
  - Structured Markdown templates are regular enough for regex-based section parsing; `unified`/`remark` AST is available as a robustness fallback but adds dependency weight.
  - Commander.js supports nested subcommands natively, enabling `reqsync sync full` / `reqsync sync diff <range>` pattern.

## Research Log

### Drizzle ORM Upsert and Transaction Patterns
- **Context**: Requirements 5.1–5.6 require upsert on `stable_id` with transactional batch processing and per-file error isolation.
- **Sources Consulted**: [Drizzle ORM Upsert Guide](https://orm.drizzle.team/docs/guides/upsert), [Drizzle Insert Docs](https://orm.drizzle.team/docs/insert), [GitHub Discussion #390](https://github.com/drizzle-team/drizzle-orm/discussions/390)
- **Findings**:
  - `onConflictDoUpdate({ target: artifacts.stableId, set: { ... } })` handles upsert natively.
  - For batch upserts, use `sql.raw('excluded.<column>')` to reference the proposed row values.
  - `buildConflictUpdateColumns` helper pattern (from docs) enables concise multi-column updates.
  - Drizzle's `db.transaction(async (tx) => { ... })` wraps operations in a PostgreSQL transaction; any thrown error rolls back.
  - Per-file error isolation: wrap each file's upsert in try/catch within the transaction, accumulate errors without re-throwing.
  - JSONB columns accept plain JS objects/arrays — Drizzle serializes automatically.
  - `getColumns` (Drizzle v1.0+) replaces `getTableColumns` for column metadata access.
- **Implications**: Upsert writer can use a single `insert(...).values(batch).onConflictDoUpdate(...)` for efficiency, or per-file inserts within a transaction for error isolation. Per-file approach preferred for error logging granularity.

### simple-git Diff Detection API
- **Context**: Requirements 2.1–2.5 require detecting A/M/D file status within a commit range.
- **Sources Consulted**: [simple-git npm](https://www.npmjs.com/package/simple-git), [simple-git TypeScript typings](https://github.com/steveukx/git-js/blob/main/simple-git/typings/simple-git.d.ts)
- **Findings**:
  - `diffSummary(commitRange)` returns `DiffResult` with `{ files: FileStatusResult[], insertions, deletions }` — but `FileStatusResult` does not include A/M/D status directly.
  - For A/M/D status: use `git.raw(['diff', '--name-status', fromCommit + '..' + toCommit])` which outputs lines like `A\tpath/to/file.md`, `M\tpath/to/file.md`, `D\tpath/to/file.md`.
  - For full sync (walk all files): use `git.raw(['ls-files', '*.md'])` or glob the repo directory.
  - `simple-git` is Promise-based with full TypeScript support; maintained at [steveukx/git-js](https://github.com/steveukx/git-js).
- **Implications**: Diff detector uses `git.raw(['diff', '--name-status', range])` and parses output. Full sync uses filesystem walk filtered to tracked directories.

### Markdown Parsing Strategy: Regex vs. Remark
- **Context**: Requirement 1 requires parsing 16 artifact types with Identification, Metadata, freeform, and link sections.
- **Sources Consulted**: [remark-parse](https://unifiedjs.com/explore/package/remark-parse/), [unified GitHub](https://github.com/unifiedjs/unified), [remarkjs/remark](https://github.com/remarkjs/remark)
- **Findings**:
  - **Remark approach**: `unified().use(remarkParse)` produces an mdast (Markdown AST). Use `unist-util-visit` to traverse headings and extract sections. Full TypeScript support. Handles edge cases (nested lists, code blocks, tables) robustly.
  - **Regex approach**: Split on `\n## ` to get H2 sections. Parse `- Key: Value` lines with `/^-\s+(.+?):\s+(.+)$/`. Extract H1 title with `/^#\s+(.+)$/m`. Simpler, zero additional dependencies, but fragile if content contains `## ` in code blocks.
  - **Hybrid**: Use remark-parse for AST, then walk AST nodes programmatically to extract sections. Best of both: robust parsing, structured extraction.
- **Implications**: Selected **hybrid** approach — remark-parse for AST construction, then custom visitor logic for section extraction. Provides robustness against edge cases while keeping extraction logic simple and type-safe.

### CLI Framework: Commander.js
- **Context**: Requirements 6 and 8 define two CLI tools with subcommands.
- **Sources Consulted**: [Commander.js GitHub](https://github.com/tj/commander.js), [npm commander](https://www.npmjs.com/package/commander), [Nested subcommands guide](https://maxschmitt.me/posts/nested-subcommands-commander-node-js)
- **Findings**:
  - Commander.js supports nested subcommands via `.command().addCommand()` pattern.
  - `program.command('sync').command('full')` and `program.command('sync').command('diff').argument('<range>')` directly model the `reqsync` CLI.
  - Global options (`--repo`, `--db`) propagate to subcommands.
  - TypeScript definitions included in package.
- **Implications**: Commander.js is the CLI framework for both `reqsync` and `reqgen`.

### Fastify Webhook Server
- **Context**: Requirement 7 defines a minimal HTTP server with two endpoints.
- **Sources Consulted**: [Fastify docs](https://fastify.dev/docs/latest/Reference/Server/), [Fastify TypeScript](https://fastify.dev/docs/latest/Reference/TypeScript/)
- **Findings**:
  - Fastify 5.x is current, with full TypeScript support.
  - Webhook endpoint: `fastify.post('/webhook/git', handler)` with JSON schema validation.
  - Async sync dispatch: return `202 Accepted` immediately, then `setImmediate(() => syncEngine.run(...))` or use a simple queue.
  - Status endpoint: `fastify.get('/status', handler)` queries last `sync_runs` row.
- **Implications**: Single-file Fastify server with two routes. No plugins needed beyond core.

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| Pipeline | Linear pipeline: Diff → Parse → Validate → Upsert | Simple mental model, clear data flow, easy to test each stage | No parallelism, but not needed at PoC scale | **Selected** — matches PRD architecture exactly |
| Event-driven | Emit events between stages, loosely coupled | Extensible, decoupled stages | Over-engineered for a PoC; adds complexity | Rejected — unnecessary for scope |
| Hexagonal | Ports & adapters around core sync domain | Clean boundaries, swappable adapters | Excessive abstraction for 4-component system | Rejected — too much ceremony for PoC |

## Design Decisions

### Decision: Markdown Parser — Hybrid Remark + Custom Visitors
- **Context**: Need to reliably parse structured Markdown across 16 artifact types
- **Alternatives Considered**:
  1. Pure regex — simpler but fragile with code blocks
  2. Full remark plugin — powerful but heavyweight for structured extraction
  3. Hybrid remark-parse + custom AST walk — robust parsing, simple extraction
- **Selected Approach**: Hybrid — use `remark-parse` to produce mdast, then walk AST nodes to extract H1 title, H2 sections, key-value pairs, and artifact ID references
- **Rationale**: Templates are structured but real content may contain edge cases (code blocks with `##`, nested lists). AST handles this correctly. Custom visitors keep extraction logic explicit and testable.
- **Trade-offs**: +Robust parsing, +Type-safe AST, -Adds unified/remark-parse/mdast dependencies
- **Follow-up**: Verify remark-parse handles all 16 template structures in integration tests

### Decision: Per-File Upsert Within Single Transaction
- **Context**: Need transactional atomicity with per-file error isolation (Req 5.5, 5.6)
- **Alternatives Considered**:
  1. Batch insert with `onConflictDoUpdate` — efficient but one failure aborts all
  2. Per-file upsert in individual transactions — isolation but no batch atomicity
  3. Per-file upsert within single transaction with try/catch — atomicity + isolation
- **Selected Approach**: Option 3 — single transaction, per-file try/catch
- **Rationale**: System-level errors (DB connection loss) roll back everything. File-level errors (parse failure, validation error) are caught, logged, and skipped without aborting the transaction.
- **Trade-offs**: +Atomicity for system errors, +Graceful degradation for file errors, -Slightly more complex than batch insert
- **Follow-up**: Verify Drizzle transaction behavior with partial failures

### Decision: Seeded PRNG for Generator Determinism
- **Context**: Requirement 8.3 requires deterministic output with `--seed`
- **Alternatives Considered**:
  1. `Math.random()` with seed polyfill — non-standard, fragile
  2. `seedrandom` npm package — lightweight, well-tested seedable PRNG
  3. Node.js `crypto` with deterministic seed — overly complex
- **Selected Approach**: `seedrandom` package for all random choices in generator
- **Rationale**: Lightweight (no dependencies), widely used, produces identical sequences for same seed across platforms
- **Trade-offs**: +Deterministic, +Simple API, -Additional dependency (minimal)
- **Follow-up**: None

## Risks & Mitigations
- **Remark AST variations across Markdown dialects** — Mitigated by using standard CommonMark parsing; templates use standard Markdown only.
- **simple-git `raw()` output parsing fragility** — Mitigated by strict regex on `--name-status` output format (stable git output format).
- **Transaction timeout on large sync batches** — Out of scope for PoC (<1,000 artifacts). Note for future: implement chunked batching.
- **Drizzle ORM version compatibility** — Pin to Drizzle v1.x; use `getColumns` (v1.0+ API).

## References
- [Drizzle ORM Upsert Guide](https://orm.drizzle.team/docs/guides/upsert) — upsert patterns and `excluded` reference
- [Drizzle ORM Insert Docs](https://orm.drizzle.team/docs/insert) — batch insert, JSONB handling
- [simple-git npm](https://www.npmjs.com/package/simple-git) — API overview and TypeScript support
- [simple-git TypeScript typings](https://github.com/steveukx/git-js/blob/main/simple-git/typings/simple-git.d.ts) — method signatures
- [remark-parse](https://unifiedjs.com/explore/package/remark-parse/) — Markdown to AST parser
- [unified](https://github.com/unifiedjs/unified) — content processing pipeline
- [Commander.js](https://github.com/tj/commander.js) — CLI framework with nested subcommands
- [Fastify TypeScript](https://fastify.dev/docs/latest/Reference/TypeScript/) — server framework TypeScript support
- [seedrandom npm](https://www.npmjs.com/package/seedrandom) — deterministic PRNG
