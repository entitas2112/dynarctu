/**
 * Server-authoritative quiz engine — TypeScript port of backend/quiz_engine.py.
 *
 * The browser only ever receives *stripped* question payloads (no
 * `Answer` field, no `IsCorrect` flags) — see `toPublicQuestion()`.
 * Grading happens here, in a serverless function, against the original
 * record kept only in the session store (Vercel KV) — never sent to the
 * client as-is — so a client can never see or tamper with the correct
 * answer. This file (and qdf.ts) must never be imported from src/.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseQdf } from './qdf.js';

// When Vercel bundles this function, `data/` is included alongside the
// function code (see vercel.json -> functions.includeFiles) and lands
// relative to the deployment's working directory.
const DATA_DIR = path.join(process.cwd(), 'data');

const WS_RE = /\s+/g;

function normalizeType(t?: string | null): string {
  if (!t) return '';
  return String(t).replace(WS_RE, '').toLowerCase();
}

export function isChoiceType(t?: string | null): boolean {
  const n = normalizeType(t);
  return n === 'pilihanganda' || n === 'multiplechoice';
}

export function isMcmaType(t?: string | null): boolean {
  const n = normalizeType(t);
  return n === 'pilihangandakompleks' || n === 'mcma';
}

export function isTrueFalseType(t?: string | null): boolean {
  const n = normalizeType(t);
  return n === 'benarsalah' || n === 'truefalse';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rec = Record<string, any>;

export function resolveCorrectIndex(options: Rec[], answer?: string | null): number {
  for (let i = 0; i < options.length; i++) {
    if (options[i]?.Text === answer) return i;
  }
  if (typeof answer === 'string' && /^[A-Za-z]$/.test(answer.trim())) {
    const letterIndex = answer.trim().toUpperCase().charCodeAt(0) - 'A'.charCodeAt(0);
    if (letterIndex >= 0 && letterIndex < options.length) return letterIndex;
  }
  for (let i = 0; i < options.length; i++) {
    if (String(options[i]?.IsCorrect || '').toLowerCase() === 'true') return i;
  }
  return -1;
}

function expectedTf(opt: Rec): string {
  const val = String(opt?.IsCorrect ?? '').trim().toLowerCase();
  return val === 'false' || val === 'salah' ? 'Salah' : 'Benar';
}

// ---------------------------------------------------------------------------
// Question bank discovery & caching (per warm lambda instance only — a cold
// start always re-reads from disk, so edits deployed via git are never stale
// across an actual deployment).
// ---------------------------------------------------------------------------

export class QuestionBankError extends Error {}

interface CacheEntry {
  mtimeMs: number;
  records: Rec[];
}

const cache = new Map<string, CacheEntry>();

/** Scans data/<jenjang>/<mapel>.qdf on disk to build a whitelist. This
 * whitelist (not raw client input) is what request validation is checked
 * against, which is what prevents path traversal / arbitrary file reads
 * via the jenjang/mapel parameters. */
export function discoverCatalog(): Record<string, string[]> {
  const catalog: Record<string, string[]> = {};
  if (!fs.existsSync(DATA_DIR)) return catalog;
  const jenjangDirs = fs
    .readdirSync(DATA_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  for (const jenjang of jenjangDirs) {
    const mapels = fs
      .readdirSync(path.join(DATA_DIR, jenjang))
      .filter((f) => f.endsWith('.qdf'))
      .map((f) => f.slice(0, -4))
      .sort();
    if (mapels.length) catalog[jenjang] = mapels;
  }
  return catalog;
}

function safePath(jenjang: string, mapel: string): string {
  const candidate = path.resolve(DATA_DIR, jenjang, `${mapel}.qdf`);
  const dataDirResolved = path.resolve(DATA_DIR);
  if (!candidate.startsWith(dataDirResolved + path.sep)) {
    throw new QuestionBankError('invalid data path');
  }
  return candidate;
}

export function loadBank(jenjang: string, mapel: string): Rec[] {
  const filePath = safePath(jenjang, mapel);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    throw new QuestionBankError(`question bank not found: ${jenjang}/${mapel}`);
  }
  if (!stat.isFile()) {
    throw new QuestionBankError(`question bank not found: ${jenjang}/${mapel}`);
  }

  const key = `${jenjang}/${mapel}`;
  const cached = cache.get(key);
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    return cached.records;
  }

  const text = fs.readFileSync(filePath, 'utf-8');
  const records = parseQdf(text, 'skip');
  cache.set(key, { mtimeMs: stat.mtimeMs, records });
  return records;
}

export function clearCache(): void {
  cache.clear();
}

// ---------------------------------------------------------------------------
// Question selection (ports the original buildQuizSet logic)
// ---------------------------------------------------------------------------

function shuffle<T>(items: T[]): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function shuffleQuestionOptions(question: Rec): Rec {
  const options = question.Options;
  if (!Array.isArray(options) || options.length < 2) return question;
  const q: Rec = { ...question };
  if (isChoiceType(q.Type)) {
    const correctIndex = resolveCorrectIndex(options, q.Answer);
    const correctOption = correctIndex >= 0 ? options[correctIndex] : null;
    q.Options = shuffle(options);
    if (correctOption !== null) {
      q.Answer = correctOption.Text ?? q.Answer;
    }
  } else {
    q.Options = shuffle(options);
  }
  return q;
}

export interface BuildQuizSetResult {
  questions: Rec[];
  historyWasReset: boolean;
  newIds: string[];
}

export function buildQuizSet(jenjang: string, mapel: string, jumlah: number, usedIds: Set<string>): BuildQuizSetResult {
  const data = loadBank(jenjang, mapel);

  const targetChoice = Math.floor(jumlah * 0.5 + 0.5);
  const targetMcma = Math.floor(jumlah * 0.3 + 0.5);
  const targetTf = jumlah - targetChoice - targetMcma;

  const allChoice = data.filter((r) => isChoiceType(r.Type));
  const allMcma = data.filter((r) => isMcmaType(r.Type));
  const allTf = data.filter((r) => isTrueFalseType(r.Type));

  let choicePool = allChoice.filter((r) => !usedIds.has(r.ID));
  let mcmaPool = allMcma.filter((r) => !usedIds.has(r.ID));
  let tfPool = allTf.filter((r) => !usedIds.has(r.ID));

  let historyWasReset = false;
  if (choicePool.length < targetChoice || mcmaPool.length < targetMcma || tfPool.length < targetTf) {
    historyWasReset = true;
    choicePool = allChoice;
    mcmaPool = allMcma;
    tfPool = allTf;
  }

  const picked = [
    ...shuffle(choicePool).slice(0, targetChoice),
    ...shuffle(mcmaPool).slice(0, targetMcma),
    ...shuffle(tfPool).slice(0, targetTf),
  ];
  const questions = shuffle(picked).map(shuffleQuestionOptions);

  const newIds = questions.map((q) => q.ID).filter(Boolean);
  return { questions, historyWasReset, newIds };
}

// ---------------------------------------------------------------------------
// Public (client-safe) question representation — answers stripped.
// ---------------------------------------------------------------------------

export function toPublicQuestion(question: Rec, index: number) {
  const options = question.Options || [];
  const publicOptions = options.map((opt: Rec) => ({ text: opt.Text || '' }));
  return {
    index,
    type: question.Type || '',
    question: question.Question || '',
    options: publicOptions,
  };
}

// ---------------------------------------------------------------------------
// Grading (server authoritative)
// ---------------------------------------------------------------------------

export function gradeChoice(question: Rec, selectedIndex: unknown) {
  const options = question.Options || [];
  if (typeof selectedIndex !== 'number' || !Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= options.length) {
    throw new Error('invalid selected_index');
  }
  const correctIndex = resolveCorrectIndex(options, question.Answer);
  const isCorrect = selectedIndex === correctIndex;
  return {
    isCorrect,
    correctIndex,
    correctText: correctIndex >= 0 ? options[correctIndex]?.Text : question.Answer,
    explanation: question.Explanation || '',
  };
}

export function gradeMcma(question: Rec, selectedIndices: unknown) {
  const options: Rec[] = question.Options || [];
  if (!Array.isArray(selectedIndices) || !selectedIndices.every((i) => Number.isInteger(i))) {
    throw new Error('invalid selected_indices');
  }
  const selectedSet = new Set<number>(selectedIndices as number[]);
  const correctIndices = options
    .map((opt, i) => (String(opt.IsCorrect || '').toLowerCase() === 'true' ? i : -1))
    .filter((i) => i >= 0);
  const correctSet = new Set(correctIndices);
  const isCorrect = selectedSet.size === correctSet.size && [...selectedSet].every((i) => correctSet.has(i));
  return {
    isCorrect,
    correctIndices,
    explanation: question.Explanation || '',
  };
}

export function gradeTrueFalse(question: Rec, answers: unknown) {
  const options: Rec[] = question.Options || [];
  if (typeof answers !== 'object' || answers === null || Array.isArray(answers)) {
    throw new Error('invalid answers');
  }
  const given = answers as Record<string, string>;
  const correctAnswers: Record<string, string> = {};
  let allMatch = true;
  options.forEach((opt, i) => {
    const expected = expectedTf(opt);
    correctAnswers[String(i)] = expected;
    if (given[String(i)] !== expected) allMatch = false;
  });
  return {
    isCorrect: allMatch,
    correctAnswers,
    explanation: question.Explanation || '',
  };
}

export function gradeAnswer(question: Rec, payload: Rec) {
  if (isChoiceType(question.Type)) return gradeChoice(question, payload.selected_index);
  if (isMcmaType(question.Type)) return gradeMcma(question, payload.selected_indices);
  if (isTrueFalseType(question.Type)) return gradeTrueFalse(question, payload.answers);
  throw new Error('unknown question type');
}
