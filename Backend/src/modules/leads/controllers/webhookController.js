import { ApiError } from '../../../utils/ApiError.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { metaConfig, waConfig } from '../config.js';
import { processLeadgenWebhook } from '../services/metaLeadService.js';
import { processCloudWebhook } from '../services/whatsappService.js';
import { verifyChallenge, verifySignature } from '../whatsapp/webhook.js';

/// Needs app.js: express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } })
const assertSigned = (req, appSecret) => {
  if (!appSecret) throw new ApiError(503, 'Webhook app secret is not configured', { code: 'WEBHOOK_DISABLED' });
  if (!Buffer.isBuffer(req.rawBody) && typeof req.rawBody !== 'string') {
    throw new ApiError(400, 'Raw request body unavailable; signature cannot be verified', { code: 'RAW_BODY_MISSING' });
  }
  if (!verifySignature(req.rawBody, req.get('x-hub-signature-256'), appSecret)) {
    throw new ApiError(401, 'Invalid webhook signature', { code: 'BAD_SIGNATURE' });
  }
};

const challenge = (tokenOf) => (req, res) => {
  const value = verifyChallenge(req.query, tokenOf());
  if (value === null) return res.status(403).send('Forbidden');
  return res.status(200).type('text/plain').send(value);
};

export const verifyWhatsAppWebhook = challenge(() => waConfig().verifyToken);
export const verifyMetaLeadsWebhook = challenge(() => metaConfig().verifyToken);

// Signed payloads are always acknowledged with 200 once processed; per-item
// failures are logged inside the services (retries are idempotent anyway).
export const receiveWhatsAppWebhook = asyncHandler(async (req, res) => {
  assertSigned(req, waConfig().appSecret);
  const result = await processCloudWebhook(req.body);
  return res.status(200).json({ success: true, data: result });
});

export const receiveMetaLeadsWebhook = asyncHandler(async (req, res) => {
  assertSigned(req, metaConfig().appSecret);
  const result = await processLeadgenWebhook(req.body);
  return res.status(200).json({ success: true, data: result });
});
