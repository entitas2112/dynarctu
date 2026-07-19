/**
 * QDF (Question Data Format) parser — TypeScript port of backend/qdf.py.
 *
 * This is a line-based, indentation-sensitive parser. It is intentionally
 * kept inside api/_lib (server-only code, never imported by src/): QDF
 * files contain answer keys and must never be shipped to the browser as
 * raw files — see quizEngine.ts, which strips answers before anything
 * reaches the client.
 *
 * Only parsing (no serialization) is needed for this application.
 */

const KEY_RE = /^[A-Za-z0-9_]+$/;

export class QDFParseError extends Error {
  line?: number;
  raw?: string;
  constructor(message: string, line?: number, raw?: string) {
    const prefix = line !== undefined ? `QDF parse error (line ${line}): ` : 'QDF parse error: ';
    super(prefix + message);
    this.line = line;
    this.raw = raw;
  }
}

type ParsedLine = ['obj', string, null] | ['ml', string, null] | ['kv', string, string] | null;

function parseKeyed(s: string): ParsedLine {
  const colon = s.indexOf(':');
  if (colon === -1) return null;
  const key = s.slice(0, colon);
  if (!KEY_RE.test(key)) return null;
  const rest = s.slice(colon + 1);
  if (rest === '') return ['obj', key, null];
  if (rest === ' >') return ['ml', key, null];
  if (rest.startsWith(' ')) return ['kv', key, rest.slice(1).trim()];
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rec = Record<string, any>;

class Frame {
  n: number;
  ref: Rec | unknown[];
  parentRef: Rec | unknown[] | null;
  keyInParent: string | number | null;
  constructor(n: number, ref: Rec | unknown[], parentRef: Rec | unknown[] | null = null, keyInParent: string | number | null = null) {
    this.n = n;
    this.ref = ref;
    this.parentRef = parentRef;
    this.keyInParent = keyInParent;
  }
}

class StateMachine {
  root: Rec = {};
  stack: Frame[] = [];
  lineNum = 0;
  isMultiline = false;
  mlTarget: Rec | null = null;
  mlKey: string | null = null;
  mlBaseIndent = 0;
  mlBuffer: string[] = [];

  constructor() {
    this.resetRecord();
  }

  private resetRecord() {
    this.root = {};
    this.stack = [new Frame(-2, this.root, null, null)];
  }

  hardReset() {
    this.resetRecord();
    this.isMultiline = false;
    this.mlTarget = null;
    this.mlKey = null;
    this.mlBuffer = [];
  }

  private flushMultiline() {
    if (this.isMultiline && this.mlTarget && this.mlKey !== null) {
      this.mlTarget[this.mlKey] = this.mlBuffer.join('\n').replace(/\s+$/, '');
      this.isMultiline = false;
      this.mlTarget = null;
      this.mlKey = null;
      this.mlBuffer = [];
    }
  }

  feedLine(rawLine: string): Rec | null {
    this.lineNum += 1;
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;

    const length = line.length;
    let i = 0;
    let sawTab = false;
    while (i < length) {
      const c = line[i];
      if (c === ' ') {
        i += 1;
      } else if (c === '\t') {
        sawTab = true;
        i += 1;
      } else {
        break;
      }
    }
    const n = i;
    const content = line.slice(n);
    const trimmedContent = content.replace(/\s+$/, '');

    // 1. Record separator.
    if (n === 0 && trimmedContent === '---') {
      this.flushMultiline();
      const finished = Object.keys(this.root).length ? this.root : null;
      this.resetRecord();
      return finished;
    }

    // 2. Multiline capture mode.
    if (this.isMultiline) {
      if (trimmedContent === '') {
        this.mlBuffer.push('');
        return null;
      }
      if (sawTab) {
        throw new QDFParseError('tabs are forbidden in indentation', this.lineNum, rawLine);
      }
      if (n < this.mlBaseIndent) {
        this.flushMultiline();
        // falls through to standard processing below
      } else {
        this.mlBuffer.push(line.slice(this.mlBaseIndent));
        return null;
      }
    }

    // 3. Blank lines and comments.
    if (trimmedContent === '' || trimmedContent[0] === '#') {
      return null;
    }

    // 4. Indentation validation.
    if (sawTab) {
      throw new QDFParseError('tabs are forbidden in indentation', this.lineNum, rawLine);
    }
    if (n % 2 !== 0) {
      throw new QDFParseError('indent must be a multiple of 2 spaces', this.lineNum, rawLine);
    }

    // 5. Array items ("- ...").
    if (content.length >= 2 && content[0] === '-' && content[1] === ' ') {
      const itemContent = content.slice(2);

      while (this.stack[this.stack.length - 1].n > n) {
        this.stack.pop();
      }
      const top = this.stack[this.stack.length - 1];

      if (!Array.isArray(top.ref)) {
        if (top.parentRef !== null && top.keyInParent !== null) {
          const newList: unknown[] = [];
          (top.parentRef as Rec)[top.keyInParent as string] = newList;
          top.ref = newList;
        } else {
          throw new QDFParseError('root level cannot be an array', this.lineNum, rawLine);
        }
      }

      const list = top.ref as unknown[];
      const parsed = parseKeyed(itemContent);

      if (parsed && parsed[0] === 'ml') {
        const obj: Rec = {};
        list.push(obj);
        this.stack.push(new Frame(n + 1, obj, list, list.length - 1));
        this.isMultiline = true;
        this.mlTarget = obj;
        this.mlKey = parsed[1];
        this.mlBaseIndent = n + 2;
      } else if (parsed && parsed[0] === 'obj') {
        const innerObj: Rec = {};
        const wrapper: Rec = { [parsed[1]]: innerObj };
        list.push(wrapper);
        this.stack.push(new Frame(n + 1, innerObj, wrapper, parsed[1]));
      } else if (parsed && parsed[0] === 'kv') {
        const obj: Rec = { [parsed[1]]: parsed[2] };
        list.push(obj);
        this.stack.push(new Frame(n + 1, obj, list, list.length - 1));
      } else {
        list.push(itemContent.trim());
      }
      return null;
    }

    // 6. Plain key/value, key: (object), key: > (multiline).
    const parsed = parseKeyed(content);
    if (parsed) {
      while (this.stack[this.stack.length - 1].n >= n) {
        this.stack.pop();
      }
      const top = this.stack[this.stack.length - 1];

      if (Array.isArray(top.ref)) {
        throw new QDFParseError('cannot attach a raw key to an array', this.lineNum, rawLine);
      }
      const obj = top.ref as Rec;

      const [kind, key, value] = parsed;
      if (kind === 'ml') {
        obj[key] = '';
        this.isMultiline = true;
        this.mlTarget = obj;
        this.mlKey = key;
        this.mlBaseIndent = n + 2;
      } else if (kind === 'obj') {
        obj[key] = {};
        this.stack.push(new Frame(n, obj[key], obj, key));
      } else {
        obj[key] = value;
      }
      return null;
    }

    throw new QDFParseError(`unrecognized syntax -> "${rawLine}"`, this.lineNum, rawLine);
  }

  finish(): Rec | null {
    this.flushMultiline();
    return Object.keys(this.root).length ? this.root : null;
  }
}

export type OnError = 'throw' | 'skip' | ((err: QDFParseError) => void);

export function* parseStream(lines: Iterable<string>, onError: OnError = 'throw'): Generator<Rec> {
  const sm = new StateMachine();
  let skipping = false;

  for (const rawLine of lines) {
    if (skipping) {
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
      sm.lineNum += 1;
      if (line === '---') {
        sm.hardReset();
        skipping = false;
      }
      continue;
    }

    let record: Rec | null;
    try {
      record = sm.feedLine(rawLine);
    } catch (err) {
      if (onError === 'throw') throw err;
      if (typeof onError === 'function') onError(err as QDFParseError);
      skipping = true;
      continue;
    }
    if (record) yield record;
  }

  if (!skipping) {
    try {
      const last = sm.finish();
      if (last) yield last;
    } catch (err) {
      if (onError === 'throw') throw err;
      if (typeof onError === 'function') onError(err as QDFParseError);
    }
  }
}

/**
 * Parses a full QDF string into a list of record objects.
 *
 * Defaults to 'skip' (rather than 'throw') so one malformed question in a
 * large bank doesn't take the whole subject offline.
 */
export function parse(text: string, onError: OnError = 'skip'): Rec[] {
  return Array.from(parseStream(text.split('\n'), onError));
}
