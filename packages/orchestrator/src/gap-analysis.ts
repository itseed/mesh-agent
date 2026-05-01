/**
 * Endpoint Gap Analysis — Orchestrator API
 *
 * Sources cross-referenced:
 *  1. Current API  — fastify routes in server.ts, routes/sessions.ts, routes/prompt.ts
 *  2. Codebase signals — database schema (shared/src/schema.ts), manager methods,
 *                        git helpers, Streamer (Redis publish), and outbound fetch calls
 *  3. Security review findings — broken behaviour reported by reviewer agent
 *
 * Mobile-app source and original OpenAPI spec were not present in this environment.
 * Gaps are derived from internal consistency analysis only.
 */

// ─────────────────────────────────────────────────────────────────────────────
// CURRENT ENDPOINTS  (12 total)
// ─────────────────────────────────────────────────────────────────────────────
export const CURRENT_ENDPOINTS = [
  'GET  /health',
  'GET  /metrics/concurrency',
  'POST /sessions',
  'GET  /sessions',
  'GET  /sessions/:id',
  'DELETE /sessions/:id',
  'GET  /sessions/:id/output',
  'POST /prompt',
  'GET  /health/claude',
  'POST /health/claude/token',
  'GET  /health/gemini',
  'GET  /health/cursor',
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// BROKEN ENDPOINTS  (wrong or missing behaviour)
// ─────────────────────────────────────────────────────────────────────────────
export const BROKEN_ENDPOINTS = [
  {
    endpoint: 'GET /sessions/:id/output',
    severity: 'HIGH',
    problem: 'Returns empty output for all completed sessions.',
    root_cause:
      'manager.ts outputBuffer.delete(session.id) is called on the "end" event ' +
      '(line 126), so the buffer is gone by the time any POST-completion call arrives. ' +
      'getSessionOutput() reads only outputBuffer; it never falls back to the ' +
      'outputLog column written to the database.',
    fix:
      'In getSessionOutput(): if the session is no longer in sessions map, ' +
      'await store.findById(id) and return its outputLog field.',
  },
  {
    endpoint: 'GET /sessions',
    severity: 'MEDIUM',
    problem:
      'Only live (in-memory) sessions are returned; completed/killed sessions are invisible.',
    root_cause:
      'manager.listSessions() iterates this.sessions which holds only active sessions. ' +
      'Once removeSession() calls this.sessions.delete(id) the record disappears from ' +
      'GET /sessions even though it is still in the database.',
    fix:
      'Add a store method findAll() (optionally filtered) and merge results with ' +
      'live sessions, or add a separate GET /sessions/history endpoint.',
  },
  {
    endpoint: 'DELETE /sessions/:id',
    severity: 'HIGH',
    problem: 'Orphans git worktrees when deleting a session that was never started.',
    root_cause:
      'POST /sessions creates the worktree before session.start() is called. ' +
      'If DELETE is called while status is "pending", session.stop() is a no-op ' +
      '(this.process is null). The "end" event never fires, so the removeWorktree ' +
      'call in wireSessionEvents is skipped. The branch task/<taskId> and worktree ' +
      'directory remain on disk until the hourly orphan cleaner runs.',
    fix:
      'In manager.removeSession(), explicitly call removeWorktree(session.repoBaseDir, ' +
      'session.taskId) when the session status is "pending" and repoBaseDir is set.',
  },
  {
    endpoint: 'GET /sessions/:id/output',
    severity: 'LOW',
    problem: 'Returns HTTP 200 with empty body instead of 404 for unknown session IDs.',
    root_cause:
      "getSessionOutput() returns { output: '', running: false } unconditionally " +
      'when the session is not in outputBuffer or sessions map. ' +
      'There is no existence check against the store.',
    fix: 'Check manager.getSession(id) and store.findById(id); return 404 if both are null.',
  },
  {
    endpoint: 'GET /sessions/:id',
    severity: 'LOW',
    problem: 'Live and persisted sessions return inconsistent field sets.',
    root_cause:
      'The live-session branch returns { id, role, status, pid, projectId, taskId, error }; ' +
      'the store branch returns the full SessionRecord row. ' +
      'Fields missing from the live response: workingDir, prompt, createdBy, ' +
      'cliProvider, startedAt, createdAt.',
    fix: 'Map the live AgentSession to the same shape as SessionRecord.',
  },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// MISSING ENDPOINTS  (not implemented at all)
// ─────────────────────────────────────────────────────────────────────────────
export const MISSING_ENDPOINTS = [
  {
    endpoint: 'GET /sessions/:id/stream',
    severity: 'HIGH',
    problem: 'No HTTP endpoint to consume streaming session output.',
    evidence:
      'Streamer publishes every output line to Redis channel agent:{id}:output. ' +
      'There is no SSE or WebSocket route that subscribes to these events, ' +
      'so clients must connect to Redis directly.',
    suggested_impl:
      'SSE route: subscribe to Redis channel, pipe events as text/event-stream. ' +
      'Close subscription when the "end" event arrives.',
  },
  {
    endpoint: 'POST /sessions/:id/stop  (or PATCH /sessions/:id { action: "stop" })',
    severity: 'MEDIUM',
    problem: 'No way to gracefully stop a session without permanently deleting it.',
    evidence:
      'DELETE /sessions/:id calls manager.removeSession() which calls session.stop() ' +
      'AND deletes from this.sessions. There is no "stop only" operation. ' +
      'A client that wants to stop a runaway agent but retain its output record ' +
      'must re-query by taskId from the database after deletion.',
    suggested_impl:
      'POST /sessions/:id/stop → call session.stop() without removing from manager.sessions.',
  },
  {
    endpoint: 'POST /health/gemini/token',
    severity: 'MEDIUM',
    problem: 'No endpoint to inject Gemini credentials at runtime.',
    evidence:
      'POST /health/claude/token writes an auth token to /root/.claude/token. ' +
      'No equivalent exists for Gemini. GET /health/gemini checks GEMINI_API_KEY ' +
      'from process.env and ~/.gemini/oauth_creds.json, but neither path is writable ' +
      'via the API.',
    suggested_impl:
      'POST /health/gemini/token { token: string } → write to ~/.gemini/oauth_creds.json ' +
      'or set GEMINI_API_KEY in a persistent env file.',
  },
  {
    endpoint: 'POST /health/cursor/token',
    severity: 'LOW',
    problem: 'No endpoint to inject Cursor agent credentials at runtime.',
    evidence:
      'GET /health/cursor checks /root/.local/bin/agent status but there is no ' +
      'corresponding token-write endpoint.',
    suggested_impl: 'Mirror the /health/claude/token pattern for the Cursor agent binary.',
  },
  {
    endpoint: 'DELETE /repos/:projectId',
    severity: 'LOW',
    problem: 'removeProjectDir() is implemented but not exposed.',
    evidence:
      'git.ts exports removeProjectDir(reposBaseDir, projectId) which runs ' +
      'rm -rf {REPOS_BASE_DIR}/{projectId}. No route calls this function. ' +
      'Projects deleted upstream leave repo directories on disk indefinitely.',
    suggested_impl:
      'DELETE /repos/:projectId → call removeProjectDir(env.REPOS_BASE_DIR, projectId). ' +
      'Guard with x-internal-secret.',
  },
  {
    endpoint: 'GET /sessions?projectId=&status=&role=&limit=&offset=',
    severity: 'MEDIUM',
    problem: 'No query parameter filtering or pagination on the session list.',
    evidence:
      'GET /sessions returns all in-memory sessions with no way to filter by ' +
      'projectId, taskId, status, or role, and no pagination. ' +
      'Under normal load the list includes only active sessions; historical ' +
      'sessions are unreachable.',
    suggested_impl:
      'Accept optional query params; merge live + store results with cursor pagination.',
  },
  {
    endpoint: 'GET /metrics/sessions',
    severity: 'LOW',
    problem: 'agentMetrics table is written on every session end but never queryable via HTTP.',
    evidence:
      'store.recordMetric() inserts rows into agent_metrics (role, durationMs, ' +
      'outputBytes, success, createdAt). No route exposes these rows. ' +
      'Dashboards and billing have no access to historical performance data through the API.',
    suggested_impl: 'GET /metrics/sessions?role=&from=&to= → aggregate from agent_metrics table.',
  },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// INCOMPLETE IMPLEMENTATIONS  (partially correct)
// ─────────────────────────────────────────────────────────────────────────────
export const INCOMPLETE_ENDPOINTS = [
  {
    endpoint: 'GET /health',
    severity: 'MEDIUM',
    problem: 'Only checks orchestrator process liveness; does not verify Redis or Postgres.',
    evidence:
      'If Redis is down, Streamer.publishLine() drops events silently (no error surface). ' +
      'If Postgres is down, session persistence silently fails (manager logs warn). ' +
      'The health endpoint would still return { status: "ok" } in both failure modes.',
    fix:
      'Add Redis PING and a lightweight DB query (SELECT 1) to the health handler. ' +
      'Return degraded status and 503 if either dependency is unreachable.',
  },
  {
    endpoint: 'POST /sessions  (authentication)',
    severity: 'CRITICAL',
    problem: 'No inbound authentication on any endpoint.',
    evidence:
      'The orchestrator sends x-internal-secret on outbound calls to API_URL ' +
      '(manager.ts:147) but never validates it on inbound requests. ' +
      'All 12 endpoints are fully open to anyone who can reach the port. ' +
      'POST /prompt allows unauthenticated arbitrary command execution.',
    fix:
      'Add a Fastify preHandler that checks x-internal-secret against env.INTERNAL_SECRET ' +
      'for all non-public endpoints. Change the weak default secret.',
  },
  {
    endpoint: 'POST /sessions  (workingDir validation)',
    severity: 'HIGH',
    problem: 'workingDir is validated only for length, allowing path traversal.',
    evidence:
      'createSessionSchema validates z.string().min(1).max(1024). ' +
      'A value like "../../../etc" passes validation and is used as the cwd ' +
      'for the spawned agent process.',
    fix:
      'Require workingDir to be an absolute path and, in production, ' +
      'restrict it to a known base directory (env.REPOS_BASE_DIR).',
  },
  {
    endpoint: 'POST /sessions  (repoUrl SSRF)',
    severity: 'HIGH',
    problem: 'Arbitrary repoUrl allows cloning internal/private network resources.',
    evidence:
      'createSessionSchema validates z.string().url() which accepts any URL scheme. ' +
      'ensureRepo passes repoUrl directly to `git clone`. ' +
      'An attacker can clone git:// or file:// URLs, or probe internal endpoints.',
    fix: 'Allowlist URL schemes (https:// only) and optionally allowlist hostnames.',
  },
  {
    endpoint: 'GET /metrics/concurrency',
    severity: 'LOW',
    problem: 'Sessions list in response does not include createdAt or cliProvider.',
    evidence:
      'Response maps: { id, role, status } per session. ' +
      'Callers who need to determine session age or provider must issue individual ' +
      'GET /sessions/:id requests.',
    fix: 'Add createdAt and cliProvider to the concurrency metrics session list.',
  },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// DATABASE TABLES WITH ZERO API COVERAGE  (likely in the separate "api" app)
// ─────────────────────────────────────────────────────────────────────────────
export const SCHEMA_WITHOUT_ORCHESTRATOR_ROUTES = [
  'users',
  'projects',
  'tasks',
  'agent_roles',
  'cli_providers',
  'audit_log',
  'task_attachments',
  'task_comments',
  'task_activities',
  'project_context',
  'agent_outcomes',
  'companion_tokens',
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────
export const SUMMARY = {
  current_endpoint_count: 12,
  broken: BROKEN_ENDPOINTS.length, // 5
  missing: MISSING_ENDPOINTS.length, // 7
  incomplete: INCOMPLETE_ENDPOINTS.length, // 5
  critical: 1, // no auth on any endpoint
  high: 5, // output lost, worktree orphan, streaming absent, path traversal, SSRF
  medium: 5,
  low: 6,
} as const;
