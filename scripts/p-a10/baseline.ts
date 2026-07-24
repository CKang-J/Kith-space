import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import Database from "better-sqlite3";
import { projectLexicalText } from "../../src/memory/lexicalProjection.js";

function percentile(values: number[], quantile: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)] ?? 0;
}

function measure(rounds: number, operation: () => void): { p50: number; p95: number } {
  const samples: number[] = [];
  for (let index = 0; index < rounds; index += 1) {
    const started = performance.now();
    operation();
    samples.push(performance.now() - started);
  }
  return { p50: percentile(samples, 0.5), p95: percentile(samples, 0.95) };
}

function measureRounds(operation: () => void): { rounds: Array<{ p50: number; p95: number }>; medianP95: number } {
  const rounds = Array.from({ length: 5 }, () => measure(100, operation));
  return { rounds, medianP95: percentile(rounds.map((round) => round.p95), 0.5) };
}

const root = mkdtempSync(path.join(os.tmpdir(), "kith-pa10-baseline-"));
const dbPath = path.join(root, "baseline.db");
const sqlite = new Database(dbPath);

try {
  sqlite.pragma("journal_mode = WAL");
  sqlite.exec(`
    CREATE TABLE messages (id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, seq INTEGER NOT NULL, content TEXT NOT NULL);
    CREATE INDEX messages_channel_seq_idx ON messages(channel_id, seq);
    CREATE TABLE delivery_items (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      source_seq INTEGER NOT NULL,
      disposition TEXT NOT NULL
    );
    CREATE UNIQUE INDEX delivery_agent_message_uniq ON delivery_items(agent_id, message_id);
    CREATE INDEX delivery_frontier_idx ON delivery_items(agent_id, disposition, source_seq);
    CREATE TABLE memory_items (
      id INTEGER PRIMARY KEY,
      canonical_text TEXT NOT NULL,
      lexical_text TEXT NOT NULL,
      cjk_bigrams TEXT NOT NULL,
      cjk_trigrams TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE memory_fts USING fts5(lexical_text, cjk_bigrams, cjk_trigrams, content='memory_items', content_rowid='id');
  `);

  const insertMessage = sqlite.prepare("INSERT INTO messages VALUES (?, 'channel-main', ?, ?)");
  sqlite.transaction(() => {
    for (let index = 1; index <= 100_000; index += 1) insertMessage.run(`history-${index}`, index, `historical message ${index}`);
  })();

  const insertMemory = sqlite.prepare("INSERT INTO memory_items VALUES (?, ?, ?, ?, ?)");
  sqlite.transaction(() => {
    for (let index = 1; index <= 10_000; index += 1) {
      const text = index % 997 === 0
        ? `用户喜欢简洁周报格式 mixed weekly preference ${index}`
        : `Local project fact ${index} 项目事实编号${index}`;
      const lexical = projectLexicalText(text);
      insertMemory.run(index, text, lexical.lexicalText, lexical.cjkBigrams, lexical.cjkTrigrams);
    }
    sqlite.exec("INSERT INTO memory_fts(memory_fts) VALUES('rebuild')");
  })();

  let nextSeq = 100_001;
  const post = sqlite.transaction((agentCount: number) => {
    const seq = nextSeq++;
    const messageId = `message-${seq}`;
    insertMessage.run(messageId, seq, `fanout ${agentCount}`);
    const delivery = sqlite.prepare("INSERT INTO delivery_items VALUES (?, ?, ?, ?, 'pending')");
    for (let agent = 1; agent <= agentCount; agent += 1) {
      delivery.run(`${messageId}:agent-${agent}`, `agent-${agent}`, messageId, seq);
    }
  });

  const fanout = Object.fromEntries([1, 5, 20].map((agents) => [agents, measureRounds(() => post(agents))]));
  const recallQueries = [
    ["cjk_bigrams", "周报"],
    ["cjk_bigrams", "简洁"],
    ["lexical_text", "weekly"],
    ["lexical_text", "preference"],
  ] as const;
  const recall = Object.fromEntries(recallQueries.map(([column, query]) => {
    const statement = sqlite.prepare(`SELECT rowid FROM memory_fts WHERE ${column} MATCH ? LIMIT 8`);
    return [`${column}:${query}`, measureRounds(() => { statement.all(query); })];
  }));
  const pageSize = Number(sqlite.pragma("page_size", { simple: true }));
  const pageCount = Number(sqlite.pragma("page_count", { simple: true }));
  process.stdout.write(`${JSON.stringify({
    assumptions: { messages: 100_000, memories: 10_000, fanoutAgents: [1, 5, 20], recordedRounds: 5, operationsPerRound: 100 },
    fanoutMs: fanout,
    recallMs: recall,
    databaseBytes: pageSize * pageCount,
  }, null, 2)}\n`);
} finally {
  sqlite.close();
  rmSync(root, { recursive: true, force: true });
}
