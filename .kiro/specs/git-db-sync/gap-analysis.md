# Gap Analysis: git-db-sync

## Current State Investigation

### Codebase Status: Greenfield
The repository contains **zero application code** — no `package.json`, `tsconfig.json`, TypeScript/JavaScript files, or database schemas. The only files present are:
- `CLAUDE.md` — project instructions
- `.kiro/` — spec-driven development tooling configuration
- `.claude/` — Claude Code command definitions
- `.vscode/settings.json`, `.snapshots/` — IDE and snapshot config

**Conclusion:** There are no existing components, patterns, conventions, or integration surfaces to analyze. This is a pure greenfield implementation.

### Conventions (to establish)
- No naming conventions, layering, or dependency patterns exist yet
- No testing infrastructure or approach defined
- No build/lint/format configuration

---

## Requirements Feasibility Analysis

### Technical Needs by Requirement

| Req | Technical Needs | Complexity Signal |
|-----|----------------|-------------------|
| R1: Markdown Parsing | Regex or remark AST parser for structured MD sections; stable ID pattern matching | Algorithmic logic — structured templates simplify this |
| R2: Git Diff Detection | `simple-git` wrapper; diff status parsing (A/M/D); directory filtering | Simple integration — well-supported by `simple-git` |
| R3: Validation | Rule engine for per-type field checks; filename/ID cross-check; duplicate detection | Algorithmic logic — straightforward validation rules |
| R4: DB Schema | Drizzle ORM schema definitions; JSONB columns; UUID PKs; unique indexes | Simple CRUD — standard Drizzle patterns |
| R5: Upsert/Sync | Transaction management; upsert-on-conflict; soft-delete; sync_runs logging | Moderate workflow — transactional batch processing with error isolation |
| R6: CLI (reqsync) | CLI framework (e.g., commander/yargs); subcommand routing; config parsing | Simple integration |
| R7: Webhook Server | Fastify single-endpoint server; async sync dispatch; branch filtering | Simple integration — thin HTTP wrapper |
| R8: Generator (reqgen) | Template rendering (Handlebars); seeded RNG; `simple-git` for commit history | Moderate workflow — many artifact types, link graph generation |
| R9: Dependency Ordering | Topological sort or type-based ordering; two-pass processing | Algorithmic logic |
| R10: Artifact Links (Stretch) | Normalized table; second-pass resolution; dangling reference detection | Simple CRUD — post-processing of existing data |

### Missing Capabilities (Everything)
- **Project scaffolding**: `package.json`, `tsconfig.json`, ESLint, Vitest
- **Database layer**: Drizzle ORM schema, connection config, migration setup
- **Core engine**: Parser, validator, diff detector, upsert writer — all net-new
- **CLI tooling**: `reqsync` and `reqgen` command definitions
- **HTTP layer**: Fastify server for webhook
- **Templates**: Handlebars templates for repo generation (16 artifact types)
- **Test infrastructure**: Unit and integration test setup

### Research Needed
- **Markdown parsing approach**: Regex-based custom parser vs. `unified`/`remark` AST — need to evaluate trade-offs given the structured template format. Templates are regular enough that regex may suffice, but remark provides robustness for edge cases.
- **Drizzle ORM JSONB patterns**: Best practices for querying/indexing JSONB columns with Drizzle, especially for `links_json` array-of-objects.
- **Transaction error isolation**: How to log per-file errors within a single Drizzle transaction without aborting it — likely savepoints or try/catch per file within the transaction.
- **Seeded RNG for generator**: Deterministic slug generation and cross-cutting link assignment with a seedable PRNG.

---

## Implementation Approach Options

### Option A: Extend Existing Components
**Not applicable.** There are no existing components to extend.

### Option B: Create New Components (Recommended)
**Rationale:** Pure greenfield — all code is net-new. This is the only viable approach.

**Proposed structure** (informed by PRD §13 Technology Choices):

```
src/
├── db/
│   ├── schema/          # Drizzle ORM table definitions
│   ├── connection.ts    # DB connection factory
│   └── migrate.ts       # Migration runner
├── parser/
│   ├── markdown.ts      # MD → structured data extraction
│   ├── sections.ts      # H2 section splitter
│   └── links.ts         # Artifact ID reference extraction
├── validator/
│   └── index.ts         # Per-type validation rules
├── sync/
│   ├── diff.ts          # Git diff detection via simple-git
│   ├── upsert.ts        # DB upsert writer with transaction mgmt
│   ├── engine.ts        # Orchestrates: diff → parse → validate → upsert
│   └── ordering.ts      # Dependency-order sorting
├── cli/
│   ├── reqsync.ts       # CLI entry point (sync full/diff, validate, status)
│   └── reqgen.ts        # Generator CLI entry point
├── webhook/
│   └── server.ts        # Fastify webhook + status endpoints
├── generator/
│   ├── index.ts         # Orchestrates repo generation
│   ├── templates/       # Handlebars templates per artifact type
│   ├── links.ts         # Link graph builder
│   └── git-history.ts   # Multi-commit history simulation
└── types/
    └── index.ts         # Shared type definitions (ArtifactType, ParsedArtifact, etc.)
```

**Trade-offs:**
- ✅ Clean module boundaries from the start
- ✅ Each component testable in isolation
- ✅ Aligns with PRD architecture (parser, validator, diff detector, upsert writer)
- ❌ More upfront scaffolding work
- ❌ No existing patterns to accelerate development

### Option C: Hybrid Approach
**Not applicable.** No existing code to hybridize with.

---

## Implementation Complexity & Risk

### Overall Assessment

| Dimension | Rating | Justification |
|-----------|--------|---------------|
| **Effort** | **L (1–2 weeks)** | Significant functionality across 4 deliverables (sync engine, CLI, webhook, generator); 16 artifact types to handle; database + git + HTTP integration |
| **Risk** | **Medium** | All technologies are well-documented (Drizzle, simple-git, Fastify, Handlebars); structured templates reduce parser complexity; main risk is the breadth of 16 artifact types and ensuring the generator produces test data that fully exercises the parser |

### Per-Component Effort

| Component | Effort | Risk | Notes |
|-----------|--------|------|-------|
| Project scaffolding | S | Low | Standard TS project setup |
| DB schema (Drizzle) | S | Low | Two core tables, well-defined columns |
| Markdown parser | M | Medium | 16 types but uniform structure; regex vs. remark decision |
| Validator | S | Low | Straightforward rule checks |
| Git diff detector | S | Low | `simple-git` handles the heavy lifting |
| Upsert writer + sync engine | M | Medium | Transaction management, error isolation, idempotency |
| CLI (reqsync) | S | Low | Thin wrapper over sync engine |
| Webhook server | S | Low | Single Fastify endpoint |
| Repo generator (reqgen) | M | Medium | 16 templates, link graph, git history simulation |
| Normalized links (stretch) | S | Low | Post-processing pass |

---

## Recommendations for Design Phase

### Preferred Approach
**Option B: Create New Components** — the only viable path for a greenfield project.

### Key Decisions for Design
1. **Markdown parser strategy**: Regex-based vs. `unified`/`remark`. Recommend evaluating both during design — leaning regex given the highly structured templates, with remark as fallback for robustness.
2. **Monorepo vs. single package**: The PRD implies a single TypeScript package. Confirm whether `reqsync` and `reqgen` share code or are separate entry points in one package.
3. **Test strategy**: Unit tests per parser/artifact type + integration tests using generator output. Need to decide test runner (Vitest recommended for TypeScript).
4. **Environment configuration**: How DB connection string and repo path are passed — CLI args, env vars, or config file.

### Research Items to Carry Forward
- Drizzle ORM transaction savepoints for per-file error isolation
- Optimal JSONB indexing strategy for `links_json` queries
- Seeded PRNG library selection for deterministic generator output
- `simple-git` diff parsing API for commit range resolution
