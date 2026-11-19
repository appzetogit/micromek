import { Router } from 'express';
import { adminGuard } from '../../shared/guards.js';
import * as l from '../controllers/leadController.js';
import * as w from '../controllers/whatsappController.js';
import * as h from '../controllers/webhookController.js';

export const leadsRouter = Router();

// Public webhooks (Meta). Signature-checked over req.rawBody.
leadsRouter.get('/webhooks/whatsapp', h.verifyWhatsAppWebhook);
leadsRouter.post('/webhooks/whatsapp', h.receiveWhatsAppWebhook);
leadsRouter.get('/webhooks/meta/leads', h.verifyMetaLeadsWebhook);
leadsRouter.post('/webhooks/meta/leads', h.receiveMetaLeadsWebhook);

// Admin
const admin = Router();
admin.use(...adminGuard('leads.view'));

admin.get('/leads', l.listLeads);
admin.post('/leads', l.createManualLead);
admin.get('/leads/stats', l.leadStatsHandler);
admin.get('/leads/meta', l.meta);
admin.get('/leads/assignees', l.listAssignees);
admin.get('/leads/follow-ups', l.listAllFollowUps);
admin.post('/leads/bulk-assign', l.bulkAssign);
admin.get('/leads/:id', l.getLead);
admin.patch('/leads/:id', l.updateLead);
admin.delete('/leads/:id', l.deleteLead);
admin.post('/leads/:id/assign', l.assignLeadHandler);
admin.post('/leads/:id/status', l.changeStatus);
admin.post('/leads/:id/activities', l.addActivity);
admin.get('/leads/:id/follow-ups', l.listLeadFollowUps);
admin.post('/leads/:id/follow-ups', l.addFollowUp);
admin.patch('/leads/:id/follow-ups/:followUpId', l.editFollowUp);
admin.delete('/leads/:id/follow-ups/:followUpId', l.removeFollowUp);

admin.get('/whatsapp/status', w.whatsappStatus);
admin.get('/whatsapp/conversations', w.listConversations);
admin.get('/whatsapp/conversations/:id', w.getConversation);
admin.get('/whatsapp/conversations/:id/messages', w.listMessages);
admin.post('/whatsapp/conversations/:id/messages', w.sendReply);
admin.post('/whatsapp/conversations/:id/:action(handover|bot|close|reopen)', w.conversationAction);
admin.patch('/whatsapp/contacts/:id', w.updateContact);
admin.get('/whatsapp/templates', w.listTemplatesHandler);
admin.post('/whatsapp/templates/sync', w.syncTemplatesHandler);
admin.get('/whatsapp/broadcasts', w.listBroadcasts);
admin.post('/whatsapp/broadcasts', w.createBroadcastHandler);
admin.get('/whatsapp/broadcasts/:id', w.getBroadcast);
admin.patch('/whatsapp/broadcasts/:id', w.updateBroadcastHandler);
admin.delete('/whatsapp/broadcasts/:id', w.deleteBroadcastHandler);
admin.post('/whatsapp/broadcasts/:id/:action(approve|run|cancel)', w.broadcastAction);

leadsRouter.use('/admin', (req, res, next) =>
  // Only claim the paths this module owns; everything else falls through to the taxi admin router.
  /^\/(leads|whatsapp)(\/|$)/.test(req.path) ? admin(req, res, next) : next());
