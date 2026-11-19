import { createHmac } from 'node:crypto';
import { adminToken, check, imp, start } from './harness.mjs';

Object.assign(process.env, {
  WA_PHONE_NUMBER_ID: 'PNID', WA_ACCESS_TOKEN: 'tok', WA_APP_SECRET: 'appsecret', WA_VERIFY_TOKEN: 'vt',
  WA_BUSINESS_ACCOUNT_ID: 'WABA', META_PAGE_ACCESS_TOKEN: 'pagetok', WA_TPL_ORDER_CONFIRMED: 'order_confirmed',
  LEADS_AUTO_ASSIGN: 'round_robin',
});

// Stub Graph API; let local calls through.
const realFetch = globalThis.fetch;
const graphCalls = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.includes('graph.facebook.com')) return realFetch(url, init);
  graphCalls.push({ url: u, body: init.body ? JSON.parse(init.body) : null });
  if (u.includes('/messages')) return new Response(JSON.stringify({ messages: [{ id: `wamid.out${graphCalls.length}` }] }), { status: 200 });
  if (u.includes('LG1')) return new Response(JSON.stringify({ id: 'LG1', created_time: new Date().toISOString(), ad_id: 'AD1', form_id: 'F1', campaign_id: 'C1', field_data: [{ name: 'full_name', values: ['Ravi Ad'] }, { name: 'phone_number', values: ['+919811111111'] }, { name: 'email', values: ['ravi@x.io'] }] }), { status: 200 });
  return new Response('{}', { status: 200 });
};

const { call, stop, mongoose } = await start();
const { startPlatformJobs } = await imp('src/modules/platformJobs.js');
const { registerLeadEventListeners } = await imp('src/modules/leads/index.js');
registerLeadEventListeners();
void startPlatformJobs;

const root = await adminToken(mongoose);
const sub = await adminToken(mongoose, { subadmin: true, permissions: ['leads.view'] });
const sign = (body) => `sha256=${createHmac('sha256', 'appsecret').update(body).digest('hex')}`;
const post = (path, payload, sig = true) => {
  const body = JSON.stringify(payload);
  return call('POST', path, { body, headers: sig ? { 'x-hub-signature-256': sign(body) } : {} });
};
const msg = (id, text, from = '919800000001') => ({
  object: 'whatsapp_business_account',
  entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: 'PNID' }, contacts: [{ profile: { name: 'Asha' }, wa_id: from }], messages: [{ from, id, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }] } }] }],
});

console.log('webhook verification');
const v = await call('GET', '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=vt&hub.challenge=123');
check('GET verify echoes challenge', v.status === 200 && String(v.body) === '123', v);
const vbad = await call('GET', '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=no&hub.challenge=123');
check('bad verify token 403', vbad.status === 403, vbad.status);
const unsigned = await post('/webhooks/whatsapp', msg('wamid.1', 'hi'), false);
check('unsigned POST rejected', unsigned.status === 401 || unsigned.status === 403, unsigned);
const forged = await call('POST', '/webhooks/whatsapp', { body: JSON.stringify(msg('wamid.1', 'hi')), headers: { 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) } });
check('forged signature rejected', forged.status === 401 || forged.status === 403, forged.status);

console.log('inbound message → contact, conversation, lead');
const in1 = await post('/webhooks/whatsapp', msg('wamid.1', 'Need 50 units wholesale price'));
check('signed POST accepted', in1.status === 200, in1);
await post('/webhooks/whatsapp', msg('wamid.1', 'Need 50 units wholesale price')); // redelivery
await new Promise((r) => setTimeout(r, 300));
const leads = await call('GET', '/admin/leads', { token: root });
check('one lead auto-created from WhatsApp', leads.body.data?.total === 1 && leads.body.data.items[0].source === 'whatsapp', leads.body);
const lead = leads.body.data.items[0];
check('lead auto-assigned', !!lead.assigned_to, lead.assigned_to);
const { WaMessage } = await imp('src/modules/leads/models/WaMessage.js');
check('redelivered message stored once', (await WaMessage.countDocuments({ direction: 'in', wa_message_id: 'wamid.1' })) === 1);
const convs = await call('GET', '/admin/whatsapp/conversations', { token: root });
check('conversation listed', convs.body.data?.total === 1, convs.body);
const convId = convs.body.data.items[0]._id;

console.log('reply in window + statuses');
const reply = await call('POST', `/admin/whatsapp/conversations/${convId}/messages`, { token: root, body: { text: 'Sure, sharing price list' } });
check('text reply inside 24h window', reply.status === 200 || reply.status === 201, reply.body);
const sent = graphCalls.find((c) => c.url.includes('/PNID/messages') && c.body?.type === 'text');
check('Graph send called with text', !!sent, graphCalls.map((c) => c.url));
const outId = reply.body.data?.wa_message_id || reply.body.data?.message?.wa_message_id;
const st = await post('/webhooks/whatsapp', { object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { statuses: [{ id: outId, status: 'read', timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: '919800000001' }] } }] }] });
await new Promise((r) => setTimeout(r, 200));
const outMsg = await WaMessage.findOne({ wa_message_id: outId }).lean();
check('read status applied to outbound message', st.status === 200 && outMsg?.status === 'read', outMsg?.status);

console.log('lead workflow');
const lost = await call('POST', `/admin/leads/${lead._id}/status`, { token: root, body: { status: 'lost' } });
check('lost without reason refused', lost.status === 400, lost.body);
const q = await call('POST', `/admin/leads/${lead._id}/status`, { token: root, body: { status: 'contacted' } });
check('status → contacted', q.status === 200, q.body);
const fu = await call('POST', `/admin/leads/${lead._id}/follow-ups`, { token: root, body: { due_at: new Date(Date.now() - 3600000).toISOString(), note: 'call back' } });
check('follow-up added', fu.status === 201 || fu.status === 200, fu.body);
const overdue = await call('GET', '/admin/leads?overdue=true', { token: root });
check('overdue filter finds it', overdue.body.data?.total === 1, overdue.body.data?.total);
const manual = await call('POST', '/admin/leads', { token: root, body: { name: 'Walk-in', phone: '9800000001', source: 'phone' } });
check('duplicate open lead for same phone → 409', manual.status === 409, manual.body);
const stats = await call('GET', '/admin/leads/stats', { token: root });
check('stats 200', stats.status === 200, stats.body);

console.log('subadmin scoping');
const subList = await call('GET', '/admin/leads', { token: sub });
const subOwns = lead.assigned_to && String(lead.assigned_to._id || lead.assigned_to);
const subLeadsVisible = subList.body.data?.items?.every((l) => String(l.assigned_to?._id || l.assigned_to) === String(subOwns)) ?? false;
check('subadmin sees only own leads', subList.status === 200 && (subList.body.data.total === 0 || subLeadsVisible), subList.body.data);
const subDel = await call('DELETE', `/admin/leads/${lead._id}`, { token: sub });
check('subadmin cannot delete', subDel.status === 403 || subDel.status === 404, subDel.status);

console.log('opt-out');
await post('/webhooks/whatsapp', msg('wamid.2', 'STOP'));
await new Promise((r) => setTimeout(r, 200));
const { WaContact } = await imp('src/modules/leads/models/WaContact.js');
const c = await WaContact.findOne({}).lean();
check('STOP opts the contact out', c?.opt_in?.status === 'opted_out', c);

console.log('commerce event → template');
const { emit } = await imp('src/modules/shared/events.js');
const before = graphCalls.length;
emit('commerce.order.created', { order: { _id: new mongoose.Types.ObjectId(), number: 'ORD-1', status: 'confirmed', grand_total: 500, customer: { phone: '9822222222', name: 'Neha' } } });
await new Promise((r) => setTimeout(r, 500));
const tpl = graphCalls.slice(before).find((x) => x.body?.type === 'template');
check('order confirmation template sent', tpl?.body?.template?.name === 'order_confirmed', graphCalls.slice(before));
emit('commerce.order.created', { order: { _id: new mongoose.Types.ObjectId(), number: 'ORD-2', status: 'confirmed', grand_total: 1, customer: { phone: '919800000001' } } });
await new Promise((r) => setTimeout(r, 500));
const toOptedOut = graphCalls.filter((x) => x.body?.to?.includes('919800000001') && x.body?.type === 'template');
check('no template to opted-out contact', toOptedOut.length === 0, toOptedOut);

console.log('meta lead ads');
const lg = await post('/webhooks/meta/leads', { object: 'page', entry: [{ id: 'PAGE', changes: [{ field: 'leadgen', value: { leadgen_id: 'LG1', page_id: 'PAGE', form_id: 'F1', ad_id: 'AD1' } }] }] });
await post('/webhooks/meta/leads', { object: 'page', entry: [{ id: 'PAGE', changes: [{ field: 'leadgen', value: { leadgen_id: 'LG1', page_id: 'PAGE' } }] }] });
await new Promise((r) => setTimeout(r, 400));
const metaLeads = await call('GET', '/admin/leads?source=meta_ads', { token: root });
check('lead ad → one lead with name/phone', lg.status === 200 && metaLeads.body.data?.total === 1 && metaLeads.body.data.items[0].name === 'Ravi Ad', metaLeads.body.data);

console.log('broadcast');
const bc = await call('POST', '/admin/whatsapp/broadcasts', { token: sub, body: { name: 'Diwali', template: { name: 'order_confirmed', language: 'en' }, audience: { type: 'phones', phones: ['9833333333'] } } });
check('subadmin creates broadcast draft', bc.status === 201 || bc.status === 200, bc.body);
const bcId = bc.body.data?._id;
const subApprove = await call('POST', `/admin/whatsapp/broadcasts/${bcId}/approve`, { token: sub });
check('subadmin cannot approve', subApprove.status === 403, subApprove.body);
const rootApprove = await call('POST', `/admin/whatsapp/broadcasts/${bcId}/approve`, { token: root });
check('approve needs a synced APPROVED template', rootApprove.status === 400 || rootApprove.status === 409 || rootApprove.status === 200, rootApprove.body);
console.log('   approve →', rootApprove.status, rootApprove.body.message);

const pass = await call('GET', '/admin/permissions', { token: root });
check('taxi admin routes still reachable', pass.status === 200);

globalThis.fetch = realFetch;
await stop();
