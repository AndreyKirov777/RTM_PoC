import Fastify from 'fastify';
import { createDb } from '../db/connection.js';
import { syncRuns } from '../db/schema.js';
import { desc } from 'drizzle-orm';
import { SyncEngine } from '../sync/sync-engine.js';
import type { ServerConfig, WebhookPayload } from '../types.js';
import type { SyncRunRow } from '../db/schema.js';

// ─── Test injection types ─────────────────────────────────────

interface WebhookServerOptions {
  /** Skip actual sync in tests */
  skipSync?: boolean;
  /** Mock last sync run for GET /status */
  mockLastRun?: SyncRunRow | null;
}

// ─── Server factory ───────────────────────────────────────────

export function buildWebhookServer(
  config: ServerConfig,
  testOpts?: WebhookServerOptions,
) {
  const fastify = Fastify({ logger: false });

  // POST /webhook/git
  fastify.post<{ Body: WebhookPayload }>('/webhook/git', async (request, reply) => {
    const body = request.body;

    // Validate required fields
    if (!body?.ref || !body?.before || !body?.after || !body?.repository?.clone_url) {
      return reply.status(400).send({ error: 'Invalid push event payload' });
    }

    // Extract branch name from ref (refs/heads/main → main)
    const branch = body.ref.replace(/^refs\/heads\//, '');

    // Check against allowed branches
    if (!config.allowedBranches.includes(branch)) {
      return reply.status(200).send({ ignored: true, branch });
    }

    // Return 202 immediately; sync runs asynchronously
    reply.status(202).send({ accepted: true });

    if (!testOpts?.skipSync) {
      setImmediate(() => {
        const engine = new SyncEngine();
        const commitRange = `${body.before}..${body.after}`;
        engine
          .runDiffSync({ repoPath: config.repoWorkDir, dbConnectionString: config.dbConnectionString }, commitRange)
          .catch(console.error);
      });
    }

    return undefined;
  });

  // GET /status
  fastify.get('/status', async (_request, reply) => {
    if (testOpts && 'mockLastRun' in testOpts) {
      if (testOpts.mockLastRun === null) {
        return reply.status(404).send({ error: 'No sync runs found' });
      }
      return reply.status(200).send(testOpts.mockLastRun);
    }

    const db = createDb(config.dbConnectionString);
    const rows = await db
      .select()
      .from(syncRuns)
      .orderBy(desc(syncRuns.startedAt))
      .limit(1);

    const last = rows[0];
    if (!last) {
      return reply.status(404).send({ error: 'No sync runs found' });
    }
    return reply.status(200).send(last);
  });

  return fastify;
}

// ─── Standalone entrypoint ────────────────────────────────────

export async function startServer(config: ServerConfig): Promise<void> {
  const server = buildWebhookServer(config);
  await server.listen({ port: config.port, host: '0.0.0.0' });
  console.log(`Webhook server listening on port ${config.port}`);
}
