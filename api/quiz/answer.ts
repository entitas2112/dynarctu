import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withHandler, methodNotAllowed } from '../_lib/handler.js';
import { getSettings } from '../_lib/config.js';
import { checkRateLimit, getSession, saveSession } from '../_lib/kv.js';
import { clientIp, getOrCreateDeviceId } from '../_lib/security.js';
import { parseQuizAnswerRequest } from '../_lib/validate.js';
import { gradeAnswer } from '../_lib/quizEngine.js';

function httpError(status: number, message: string) {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = status;
  return err;
}

export default withHandler(async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const settings = getSettings();
  await checkRateLimit('quiz_answer', clientIp(req), settings.rateLimitDefault);

  getOrCreateDeviceId(req, res); // ensures the device cookie exists/refreshes
  const payload = parseQuizAnswerRequest(req.body);

  const session = await getSession(payload.session_token);
  if (!session) throw httpError(404, 'session not found or expired');
  if (session.finished) throw httpError(409, 'quiz already finished');
  if (payload.question_index in session.answered) throw httpError(409, 'question already answered');
  if (payload.question_index >= session.questions.length) throw httpError(400, 'invalid question index');

  const question = session.questions[payload.question_index];
  let result;
  try {
    result = gradeAnswer(question, payload);
  } catch {
    throw httpError(400, 'invalid answer payload');
  }

  session.answered[payload.question_index] = result.isCorrect;
  await saveSession(session);

  res.status(200).json(result);
});
