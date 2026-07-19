import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withHandler, methodNotAllowed } from '../_lib/handler.js';
import { discoverCatalog } from '../_lib/quizEngine.js';

export default withHandler(async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  res.status(200).json(discoverCatalog());
});
