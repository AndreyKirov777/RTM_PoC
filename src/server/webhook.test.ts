import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildWebhookServer } from './webhook.js';
import type { ServerConfig } from '../types.js';

const config: ServerConfig = {
  port: 3000,
  allowedBranches: ['main'],
  repoWorkDir: '/tmp/test-repo',
  dbConnectionString: 'postgres://localhost:5432/test',
};

const validPayload = {
  ref: 'refs/heads/main',
  before: 'abc123',
  after: 'def456',
  repository: { clone_url: 'https://github.com/test/repo.git' },
};

describe('WebhookServer – POST /webhook/git (Task 9.1)', () => {
  it('returns 202 Accepted for a valid push on allowed branch', async () => {
    const server = buildWebhookServer(config, { skipSync: true });
    const response = await server.inject({
      method: 'POST',
      url: '/webhook/git',
      payload: validPayload,
    });
    expect(response.statusCode).toBe(202);
    const body = response.json<{ accepted: boolean }>();
    expect(body.accepted).toBe(true);
    await server.close();
  });

  it('returns 200 OK with no sync for non-allowed branch', async () => {
    const server = buildWebhookServer(config, { skipSync: true });
    const response = await server.inject({
      method: 'POST',
      url: '/webhook/git',
      payload: { ...validPayload, ref: 'refs/heads/feature/xyz' },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ ignored: boolean }>();
    expect(body.ignored).toBe(true);
    await server.close();
  });

  it('returns 400 for malformed payload', async () => {
    const server = buildWebhookServer(config, { skipSync: true });
    const response = await server.inject({
      method: 'POST',
      url: '/webhook/git',
      payload: { invalid: 'payload' },
    });
    expect(response.statusCode).toBe(400);
    await server.close();
  });
});

describe('WebhookServer – GET /status (Task 9.2)', () => {
  it('returns 404 when no sync runs exist', async () => {
    const server = buildWebhookServer(config, { skipSync: true, mockLastRun: null });
    const response = await server.inject({ method: 'GET', url: '/status' });
    expect(response.statusCode).toBe(404);
    await server.close();
  });

  it('returns the last sync run when available', async () => {
    const mockRun = {
      id: 'run-123',
      triggerType: 'webhook',
      commitRange: 'abc..def',
      startedAt: new Date(),
      finishedAt: new Date(),
      filesProcessed: 5,
      filesErrored: 0,
      artifactsCreated: 5,
      artifactsUpdated: 0,
      artifactsDeleted: 0,
      errorLog: [],
    };
    const server = buildWebhookServer(config, { skipSync: true, mockLastRun: mockRun });
    const response = await server.inject({ method: 'GET', url: '/status' });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ id: string }>();
    expect(body.id).toBe('run-123');
    await server.close();
  });
});
