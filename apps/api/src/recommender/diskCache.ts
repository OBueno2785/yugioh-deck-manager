/**
 * Disk-backed cache with TTL for large datasets that survive process restarts.
 * Cards are stored gzip-compressed; decks use NDJSON (one deck per line).
 */

import { readFile, writeFile, stat, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createGzip, createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Readable, Writable } from "node:stream";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DATA_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../data"
);

export const CARDS_FILE = join(DATA_DIR, "cards.json.gz");
export const DECKS_FILE = join(DATA_DIR, "decks.ndjson");
export const PROGRESS_FILE = join(DATA_DIR, "scrape-progress.json");

export async function ensureDataDir(): Promise<void> {
  if (!existsSync(DATA_DIR)) {
    await mkdir(DATA_DIR, { recursive: true });
  }
}

// ─── Gzip helpers ─────────────────────────────────────────────────────────────

export async function writeGzipJson<T>(filePath: string, data: T): Promise<void> {
  await ensureDataDir();
  const json = JSON.stringify(data);
  const chunks: Buffer[] = [];
  const gzip = createGzip();
  const readable = Readable.from([json]);
  const writable = new Writable({
    write(chunk, _enc, cb) { chunks.push(chunk); cb(); },
  });
  await pipeline(readable, gzip, writable);
  await writeFile(filePath, Buffer.concat(chunks));
}

export async function readGzipJson<T>(filePath: string): Promise<T> {
  const compressed = await readFile(filePath);
  const chunks: Buffer[] = [];
  const gunzip = createGunzip();
  const readable = Readable.from([compressed]);
  const writable = new Writable({
    write(chunk, _enc, cb) { chunks.push(chunk); cb(); },
  });
  await pipeline(readable, gunzip, writable);
  return JSON.parse(Buffer.concat(chunks).toString()) as T;
}

// ─── TTL check ────────────────────────────────────────────────────────────────

export async function isFileFresh(filePath: string, maxAgeMs: number): Promise<boolean> {
  if (!existsSync(filePath)) return false;
  const { mtimeMs } = await stat(filePath);
  return Date.now() - mtimeMs < maxAgeMs;
}

// ─── NDJSON deck store ────────────────────────────────────────────────────────

export interface StoredDeck {
  id: number;
  name: string;
  main: number[];
  extra: number[];
  side: number[];
  format?: string;
  fetchedAt: string;
}

/** Append a single deck to the NDJSON file. */
export async function appendDeck(deck: StoredDeck): Promise<void> {
  await ensureDataDir();
  const line = JSON.stringify(deck) + "\n";
  const { appendFile } = await import("node:fs/promises");
  await appendFile(DECKS_FILE, line, "utf8");
}

/** Read all decks from the NDJSON file. */
export async function readAllDecks(): Promise<StoredDeck[]> {
  if (!existsSync(DECKS_FILE)) return [];
  const content = await readFile(DECKS_FILE, "utf8");
  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as StoredDeck);
}

// ─── Scrape progress ─────────────────────────────────────────────────────────

export interface ScrapeProgress {
  totalDeckIds: number;
  processedDeckIds: number[];
  failedDeckIds: number[];
  startedAt: string;
  lastUpdatedAt: string;
}

export async function loadProgress(): Promise<ScrapeProgress | null> {
  if (!existsSync(PROGRESS_FILE)) return null;
  const content = await readFile(PROGRESS_FILE, "utf8");
  return JSON.parse(content) as ScrapeProgress;
}

export async function saveProgress(progress: ScrapeProgress): Promise<void> {
  await ensureDataDir();
  await writeFile(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}
