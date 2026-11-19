import { Router } from 'express';
import { adminGuard } from '../../shared/guards.js';
import { VIEW_PERMISSION } from '../constants.js';
import * as c from '../controllers/marketingController.js';

/// Mounted at /api and /api/v1 before the taxi router. Claims only
/// /admin/marketing/*; every other path goes to next().
export const marketingRouter = Router();

const admin = Router();
admin.use(...adminGuard(VIEW_PERMISSION));

admin.get('/marketing/status', c.status);
admin.get('/marketing/ai/usage', c.usage);

// Knowledge base
admin.get('/marketing/kb/documents', c.listDocuments);
admin.post('/marketing/kb/documents', c.ingestDocument);
admin.get('/marketing/kb/documents/:id', c.getDocument);
admin.patch('/marketing/kb/documents/:id', c.updateDocument);
admin.post('/marketing/kb/documents/:id/reindex', c.reindexDocument);
admin.delete('/marketing/kb/documents/:id', c.deleteDocument);
admin.post('/marketing/kb/sync-products', c.syncProducts);
admin.post('/marketing/kb/answer', c.testAnswer);
admin.post('/marketing/kb/recommend', c.recommend);

// Content (draft -> in_review -> approved -> scheduled -> published | rejected)
admin.get('/marketing/content', c.listContent);
admin.get('/marketing/content/calendar', c.contentCalendar);
admin.post('/marketing/content', c.createContent);
admin.post('/marketing/content/generate', c.generateContent);
admin.get('/marketing/content/:id', c.getContent);
admin.patch('/marketing/content/:id', c.updateContent);
admin.delete('/marketing/content/:id', c.deleteContent);
admin.post('/marketing/content/:id/publish', c.publishContent);
admin.post('/marketing/content/:id/:action(submit|approve|reject|schedule|unschedule)', c.transitionContent);

// Meta Ads campaign drafts
admin.get('/marketing/campaigns', c.listCampaigns);
admin.post('/marketing/campaigns', c.createCampaign);
admin.post('/marketing/campaigns/recommend', c.recommendCampaign);
admin.get('/marketing/campaigns/:id', c.getCampaign);
admin.patch('/marketing/campaigns/:id', c.updateCampaign);
admin.delete('/marketing/campaigns/:id', c.deleteCampaign);
admin.post('/marketing/campaigns/:id/metrics', c.campaignMetrics);
admin.post('/marketing/campaigns/:id/publish', c.publishCampaign);
admin.post('/marketing/campaigns/:id/:action(approve|reject|reopen)', c.transitionCampaign);

// Insights
admin.get('/marketing/insights/summary', c.insightsSummary);
admin.post('/marketing/insights/summarize', c.insightsSummarize);
admin.get('/marketing/insights/reports', c.listReports);
admin.get('/marketing/insights/reports/:id', c.getReport);
admin.post('/marketing/insights/reports/:id/:action(approve|reject)', c.reviewReport);

marketingRouter.use('/admin', (req, res, next) =>
  // Only claim the paths this module owns; everything else falls through.
  (/^\/marketing(\/|$)/.test(req.path) ? admin(req, res, next) : next()));
