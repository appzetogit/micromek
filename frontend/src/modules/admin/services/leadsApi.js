import api from '../../../shared/api/axiosInstance';
import { qs } from '../pages/platform/kit';

/**
 * Leads & WhatsApp admin API (Backend/src/modules/leads). Every function
 * resolves to the response body { success, data } and rejects with
 * { message, details, status }.
 */

// ---------- leads ----------

export const getLeadStats = (params) => api.get(`/admin/leads/stats${qs(params)}`);
export const getAssignees = () => api.get('/admin/leads/assignees');
export const listLeads = (params) => api.get(`/admin/leads${qs(params)}`);
export const createLead = (body) => api.post('/admin/leads', body);
export const getLead = (id) => api.get(`/admin/leads/${id}`);
export const updateLead = (id, body) => api.patch(`/admin/leads/${id}`, body);
export const assignLead = (id, adminId) => api.post(`/admin/leads/${id}/assign`, { admin_id: adminId || null });
export const bulkAssignLeads = (leadIds, adminId) => api.post('/admin/leads/bulk-assign', { lead_ids: leadIds, admin_id: adminId });
export const changeLeadStatus = (id, body) => api.post(`/admin/leads/${id}/status`, body);
export const addLeadActivity = (id, body) => api.post(`/admin/leads/${id}/activities`, body);

// ---------- follow-ups ----------

export const listFollowUps = (params) => api.get(`/admin/leads/follow-ups${qs(params)}`);
export const addFollowUp = (leadId, body) => api.post(`/admin/leads/${leadId}/follow-ups`, body);
export const updateFollowUp = (leadId, followUpId, body) => api.patch(`/admin/leads/${leadId}/follow-ups/${followUpId}`, body);
export const completeFollowUp = (leadId, followUpId, outcome) => updateFollowUp(leadId, followUpId, { done: true, outcome });
export const deleteFollowUp = (leadId, followUpId) => api.delete(`/admin/leads/${leadId}/follow-ups/${followUpId}`);

// ---------- WhatsApp ----------

export const getWhatsAppStatus = () => api.get('/admin/whatsapp/status');
export const listConversations = (params) => api.get(`/admin/whatsapp/conversations${qs(params)}`);
export const getConversation = (id) => api.get(`/admin/whatsapp/conversations/${id}`);
export const listMessages = (id, params) => api.get(`/admin/whatsapp/conversations/${id}/messages${qs(params)}`);
/** body: { text } or { template: { name, language, components } } */
export const sendMessage = (id, body) => api.post(`/admin/whatsapp/conversations/${id}/messages`, body);
/** action: handover | bot | close | reopen */
export const conversationAction = (id, action, body = {}) => api.post(`/admin/whatsapp/conversations/${id}/${action}`, body);
/** body: { name } and/or { opt_in_status: unknown | opted_in | opted_out } */
export const updateContact = (id, body) => api.patch(`/admin/whatsapp/contacts/${id}`, body);

export const listTemplates = (params) => api.get(`/admin/whatsapp/templates${qs(params)}`);
export const syncTemplates = () => api.post('/admin/whatsapp/templates/sync');

export const listBroadcasts = (params) => api.get(`/admin/whatsapp/broadcasts${qs(params)}`);
export const getBroadcast = (id, params) => api.get(`/admin/whatsapp/broadcasts/${id}${qs(params)}`);
export const createBroadcast = (body) => api.post('/admin/whatsapp/broadcasts', body);
export const updateBroadcast = (id, body) => api.patch(`/admin/whatsapp/broadcasts/${id}`, body);
export const deleteBroadcast = (id) => api.delete(`/admin/whatsapp/broadcasts/${id}`);
/** action: approve | run | cancel */
export const broadcastAction = (id, action) => api.post(`/admin/whatsapp/broadcasts/${id}/${action}`);
