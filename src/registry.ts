import { Database as BunSqliteDB } from "bun:sqlite";
import { join } from "path";
import { mkdirSync, existsSync } from "fs";

const DB_PATH = join(process.env["AGENT_FORGE_DATA"] ?? ".agent-forge", "registry.db");

let _db: BunSqliteDB | null = null;

export function getDb(): BunSqliteDB {
  if (_db) return _db;

  const dir = join(process.env["AGENT_FORGE_DATA"] ?? ".agent-forge");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  _db = new BunSqliteDB(DB_PATH);
  _db.exec("PRAGMA journal_mode = WAL");
  initSchema(_db);
  return _db;
}

function initSchema(db: BunSqliteDB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      latest_version INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS agent_versions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      code TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(agent_id, version)
    );

    CREATE TABLE IF NOT EXISTS eval_runs (
      id TEXT PRIMARY KEY,
      agent_version_id TEXT NOT NULL REFERENCES agent_versions(id) ON DELETE CASCADE,
      iteration INTEGER NOT NULL,
      test_pass_rate REAL,
      judge_score REAL,
      composite_score REAL,
      passed INTEGER,
      failure_report TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS test_cases (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      input_json TEXT NOT NULL,
      expected_schema TEXT NOT NULL,
      traced_to TEXT,
      diversity_score REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_versions_agent_id ON agent_versions(agent_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_eval_runs_version_id ON eval_runs(agent_version_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_test_cases_agent_id ON test_cases(agent_id)`);
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

// Agent CRUD

export interface AgentRow {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  latest_version: number;
}

export function createAgent(name: string, description: string): AgentRow {
  const db = getDb();
  const id = generateId();
  db.prepare(
    "INSERT INTO agents (id, name, description, latest_version) VALUES (?, ?, ?, 0)"
  ).run(id, name, description);
  return db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow;
}

export function getAgentByName(name: string): AgentRow | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM agents WHERE name = ?").get(name) as AgentRow | undefined;
  return row ?? null;
}

export function getAllAgents(): AgentRow[] {
  const db = getDb();
  return db.prepare("SELECT * FROM agents ORDER BY created_at DESC").all() as AgentRow[];
}

export function updateAgentLatestVersion(agentId: string, version: number): void {
  const db = getDb();
  db.prepare("UPDATE agents SET latest_version = ? WHERE id = ?").run(version, agentId);
}

// Version CRUD

export interface VersionRow {
  id: string;
  agent_id: string;
  version: number;
  code: string;
  created_at: string;
}

export function createAgentVersion(
  agentId: string,
  version: number,
  code: string
): VersionRow {
  const db = getDb();
  const id = generateId();
  db.prepare(
    "INSERT INTO agent_versions (id, agent_id, version, code) VALUES (?, ?, ?, ?)"
  ).run(id, agentId, version, code);
  updateAgentLatestVersion(agentId, version);
  return db.prepare("SELECT * FROM agent_versions WHERE id = ?").get(id) as VersionRow;
}

export function getAgentVersion(
  agentId: string,
  version: number
): VersionRow | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM agent_versions WHERE agent_id = ? AND version = ?")
    .get(agentId, version) as VersionRow | undefined;
  return row ?? null;
}

export function getLatestAgentVersion(agentId: string): VersionRow | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM agent_versions WHERE agent_id = ? ORDER BY version DESC LIMIT 1")
    .get(agentId) as VersionRow | undefined;
  return row ?? null;
}

export function getAllAgentVersions(agentId: string): VersionRow[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM agent_versions WHERE agent_id = ? ORDER BY version ASC")
    .all(agentId) as VersionRow[];
}

// Eval CRUD

export interface EvalRunRow {
  id: string;
  agent_version_id: string;
  iteration: number;
  test_pass_rate: number | null;
  judge_score: number | null;
  composite_score: number | null;
  passed: number | null;
  failure_report: string | null;
  created_at: string;
}

export function createEvalRun(params: {
  agentVersionId: string;
  iteration: number;
  testPassRate: number;
  judgeScore: number;
  compositeScore: number;
  passed: boolean;
  failureReport: unknown;
}): EvalRunRow {
  const db = getDb();
  const id = generateId();
  db.prepare(
    `INSERT INTO eval_runs
     (id, agent_version_id, iteration, test_pass_rate, judge_score, composite_score, passed, failure_report)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    params.agentVersionId,
    params.iteration,
    params.testPassRate,
    params.judgeScore,
    params.compositeScore,
    params.passed ? 1 : 0,
    JSON.stringify(params.failureReport)
  );
  return db.prepare("SELECT * FROM eval_runs WHERE id = ?").get(id) as EvalRunRow;
}

export function getEvalRunsForVersion(agentVersionId: string): EvalRunRow[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM eval_runs WHERE agent_version_id = ? ORDER BY iteration ASC")
    .all(agentVersionId) as EvalRunRow[];
}

export function getBestEvalForAgent(agentId: string): EvalRunRow | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT er.* FROM eval_runs er
       JOIN agent_versions av ON er.agent_version_id = av.id
       WHERE av.agent_id = ? AND er.passed = 1
       ORDER BY er.composite_score DESC
       LIMIT 1`
    )
    .get(agentId) as EvalRunRow | undefined;
  return row ?? null;
}

// Test Case CRUD

export interface TestCaseRow {
  id: string;
  agent_id: string;
  input_json: string;
  expected_schema: string;
  traced_to: string | null;
  diversity_score: number | null;
  created_at: string;
}

export function createTestCase(params: {
  agentId: string;
  input: unknown;
  expectedSchema: unknown;
  tracedTo: string[];
  diversityScore: number;
}): TestCaseRow {
  const db = getDb();
  const id = generateId();
  db.prepare(
    `INSERT INTO test_cases
     (id, agent_id, input_json, expected_schema, traced_to, diversity_score)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    params.agentId,
    JSON.stringify(params.input),
    JSON.stringify(params.expectedSchema),
    JSON.stringify(params.tracedTo),
    params.diversityScore
  );
  return db.prepare("SELECT * FROM test_cases WHERE id = ?").get(id) as TestCaseRow;
}

export function getTestCasesForAgent(agentId: string): TestCaseRow[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM test_cases WHERE agent_id = ? ORDER BY created_at ASC")
    .all(agentId) as TestCaseRow[];
}

export function deleteTestCasesForAgent(agentId: string): void {
  const db = getDb();
  db.prepare("DELETE FROM test_cases WHERE agent_id = ?").run(agentId);
}
