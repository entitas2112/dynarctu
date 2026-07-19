export const ALLOWED_JUMLAH = [10, 20, 30];
export const ALLOWED_DURASI = [10, 20, 30];

export class ValidationError extends Error {}

function isBareIdentifier(v: unknown): v is string {
  if (typeof v !== 'string' || v.length < 1) return false;
  // Defense in depth: reject anything that isn't a bare alnum/underscore
  // identifier before it's even checked against the on-disk whitelist.
  return /^[A-Za-z0-9_]+$/.test(v);
}

export interface QuizStartRequest {
  jenjang: string;
  mapel: string;
  jumlah: number;
  durasi: number;
}

export function parseQuizStartRequest(body: unknown): QuizStartRequest {
  if (typeof body !== 'object' || body === null) throw new ValidationError('invalid request');
  const b = body as Record<string, unknown>;

  if (!isBareIdentifier(b.jenjang) || (b.jenjang as string).length > 20) throw new ValidationError('invalid jenjang');
  if (!isBareIdentifier(b.mapel) || (b.mapel as string).length > 30) throw new ValidationError('invalid mapel');
  if (typeof b.jumlah !== 'number' || !ALLOWED_JUMLAH.includes(b.jumlah)) throw new ValidationError('invalid jumlah');
  if (typeof b.durasi !== 'number' || !ALLOWED_DURASI.includes(b.durasi)) throw new ValidationError('invalid durasi');

  return {
    jenjang: (b.jenjang as string).toLowerCase(),
    mapel: (b.mapel as string).toLowerCase(),
    jumlah: b.jumlah,
    durasi: b.durasi,
  };
}

export interface QuizAnswerRequest {
  session_token: string;
  question_index: number;
  selected_index?: number;
  selected_indices?: number[];
  answers?: Record<string, string>;
}

export function parseQuizAnswerRequest(body: unknown): QuizAnswerRequest {
  if (typeof body !== 'object' || body === null) throw new ValidationError('invalid request');
  const b = body as Record<string, unknown>;

  const token = b.session_token;
  if (typeof token !== 'string' || token.length < 10 || token.length > 200) {
    throw new ValidationError('invalid session_token');
  }
  const index = b.question_index;
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= 100) {
    throw new ValidationError('invalid question_index');
  }
  return {
    session_token: token,
    question_index: index,
    selected_index: typeof b.selected_index === 'number' ? b.selected_index : undefined,
    selected_indices: Array.isArray(b.selected_indices) ? (b.selected_indices as number[]) : undefined,
    answers:
      typeof b.answers === 'object' && b.answers !== null && !Array.isArray(b.answers)
        ? (b.answers as Record<string, string>)
        : undefined,
  };
}

export interface QuizFinishRequest {
  session_token: string;
}

export function parseQuizFinishRequest(body: unknown): QuizFinishRequest {
  if (typeof body !== 'object' || body === null) throw new ValidationError('invalid request');
  const b = body as Record<string, unknown>;
  const token = b.session_token;
  if (typeof token !== 'string' || token.length < 10 || token.length > 200) {
    throw new ValidationError('invalid session_token');
  }
  return { session_token: token };
}
