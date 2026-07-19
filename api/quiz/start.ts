import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withHandler, methodNotAllowed } from '../_lib/handler.js';
import { getSettings } from '../_lib/config.js';
import { checkRateLimit } from '../_lib/kv.js';
import { clientIp, getOrCreateDeviceId } from '../_lib/security.js';
import { parseQuizStartRequest } from '../_lib/validate.js';
import { discoverCatalog, buildQuizSet, toPublicQuestion, QuestionBankError } from '../_lib/quizEngine.js';
import { getUsedQuestionIds, addUsedQuestionIds, clearUsedQuestions, createSession } from '../_lib/kv.js';

function catalogOr404(jenjang: string, mapel: string): void {
  const catalog = discoverCatalog();
  if (!catalog[jenjang] || !catalog[jenjang].includes(mapel)) {
    // Generic message: don't reveal which part (jenjang vs mapel) was wrong.
    throw new QuestionBankError('question bank not available');
  }
}

export default withHandler(async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const settings = getSettings();
  await checkRateLimit('quiz_start', clientIp(req), settings.rateLimitQuizStart);

  const payload = parseQuizStartRequest(req.body);
  catalogOr404(payload.jenjang, payload.mapel);
  const deviceId = getOrCreateDeviceId(req, res);

  const usedIds = await getUsedQuestionIds(deviceId, payload.jenjang, payload.mapel);

  const { questions, historyWasReset, newIds } = buildQuizSet(payload.jenjang, payload.mapel, payload.jumlah, usedIds);

  if (historyWasReset) {
    await clearUsedQuestions(deviceId, payload.jenjang, payload.mapel);
  }

  if (!questions.length) {
    res.status(200).json({ questions: [], sessionToken: null, historyWasReset });
    return;
  }

  await addUsedQuestionIds(deviceId, payload.jenjang, payload.mapel, newIds);

  const session = await createSession({
    deviceId,
    jenjang: payload.jenjang,
    mapel: payload.mapel,
    questions,
    durationSeconds: payload.durasi * 60,
  });

  const publicQuestions = questions.map((q, i) => toPublicQuestion(q, i));
  res.status(200).json({
    sessionToken: session.sessionToken,
    durationSeconds: session.durationSeconds,
    historyWasReset,
    questions: publicQuestions,
  });
});
