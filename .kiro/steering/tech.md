# Tech Stack

## Runtime & Language
- Node.js >= 20, TypeScript 5.7 (ESM, `"type": "module"`)
- Strict TypeScript: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`
- Module resolution: `Bundler`; all local imports must use `.js` extension

## Key Libraries
- **Database**: Drizzle ORM + `pg` (node-postgres) against PostgreSQL
- **Markdown parsing**: `unified` + `remark-parse` + `mdast-util-to-string` + `unist-util-visit`
- **CLI**: `commander`
- **HTTP server**: Fastify v5
- **Test data generation**: `seedrandom`, `handlebars`
- **Git operations**: `simple-git`

## Build & Tooling
- **Build**: `tsup` (ESM output, `dist/`, adds `#!/usr/bin/env node` banner to CLI entries)
- **Dev run**: `tsx` (no compile step needed)
- **Test**: Vitest 3 (`globals: true`, `environment: node`)
- **DB migrations**: `drizzle-kit`

## Common Commands

```bash
# Run tests (single pass)
npm test

# Run tests with coverage
npm run test:coverage

# Build for distribution
npm run build

# Run CLI directly (dev)
npx tsx src/cli/reqsync.ts --repo <path> --db <url> sync full
npx tsx src/cli/reqgen.ts --help

# DB migrations
npm run db:generate
npm run db:migrate
```

## Environment
- `DATABASE_URL` — PostgreSQL connection string (default: `postgres://localhost:5432/gitdbsync`)
