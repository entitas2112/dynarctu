import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withHandler, methodNotAllowed } from '../_lib/handler.js';
import { getSettings } from '../_lib/config.js';
import { checkRateLimit } from '../_lib/kv.js';
import { clientIp, requireAdminToken } from '../_lib/security.js';
import { discoverCatalog, loadBank, QuestionBankError } from '../_lib/quizEngine.js';

export default withHandler(async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  requireAdminToken(req);
  const settings = getSettings();
  await checkRateLimit('admin', clientIp(req), settings.rateLimitAdmin);

  // Question bank inventory (counts only — never returns question content
  // or answers, so a leaked admin token still can't be used to scrape the
  // bank; use the authoring files on disk/in the repo for that).
  const catalog = discoverCatalog();
  const inventory: Record<string, Record<string, number>> = {};
  for (const [jenjang, mapels] of Object.entries(catalog)) {
    inventory[jenjang] = {};
    for (const mapel of mapels) {
      try {
        inventory[jenjang][mapel] = loadBank(jenjang, mapel).length;
      } catch (err) {
        if (err instanceof QuestionBankError) {
          inventory[jenjang][mapel] = 0;
        } else {
          throw err;
        }
      }
    }
  }
  res.status(200).json(inventory);
});
