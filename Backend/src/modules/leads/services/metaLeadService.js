import { Lead } from '../models/Lead.js';
import { WaContact } from '../models/WaContact.js';
import { fetchMetaLead } from '../whatsapp/client.js';
import { mapLeadFieldData, parseLeadgenWebhook } from '../whatsapp/webhook.js';
import { activity, createLead, phoneOf, pushActivity } from './leadService.js';

const warn = (...args) => console.warn('[leads/meta]', ...args);

const summarise = (answers = {}) =>
  Object.entries(answers)
    .filter(([k]) => !['full_name', 'first_name', 'last_name', 'phone_number', 'email'].includes(k))
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
    .join('\n')
    .slice(0, 2000);

/// One Lead Ads notification -> Lead (source meta_ads). Idempotent on leadgen_id.
export const handleLeadgen = async (item) => {
  if (await Lead.exists({ leadgen_id: item.leadgen_id })) return { duplicate: true };
  let details = null;
  let fetchError = '';
  try {
    details = await fetchMetaLead(item.leadgen_id);
  } catch (error) {
    fetchError = error.message;
    warn(`could not fetch lead ${item.leadgen_id}:`, error.message);
  }
  const mapped = mapLeadFieldData(details?.field_data);
  const phone = phoneOf(mapped.phone);
  const contact = phone ? await WaContact.findOne({ wa_id: phone }).select('_id').lean() : null;
  let lead;
  try {
    lead = await createLead({
      source: 'meta_ads',
      leadgen_id: item.leadgen_id,
      name: mapped.name,
      phone,
      email: mapped.email,
      city: mapped.city,
      requirement: summarise(mapped.answers),
      form_answers: Object.keys(mapped.answers).length ? mapped.answers : undefined,
      contact: contact?._id || null,
      campaign: {
        campaign_id: String(details?.campaign_id || ''),
        campaign_name: String(details?.campaign_name || ''),
        adset_id: String(details?.adset_id || item.adgroup_id || ''),
        adset_name: String(details?.adset_name || ''),
        ad_id: String(details?.ad_id || item.ad_id || ''),
        ad_name: String(details?.ad_name || ''),
        form_id: String(details?.form_id || item.form_id || ''),
        page_id: item.page_id,
        platform: String(details?.platform || ''),
      },
    });
  } catch (error) {
    if (error?.code === 11000) return { duplicate: true };
    throw error;
  }
  if (fetchError) {
    pushActivity(lead, activity('system', { note: `Lead details could not be fetched from Meta: ${fetchError}` }));
    await lead.save();
  }
  return { lead };
};

export const processLeadgenWebhook = async (body) => {
  const items = parseLeadgenWebhook(body);
  const result = { leads: 0, duplicates: 0, errors: 0 };
  for (const item of items) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const r = await handleLeadgen(item);
      if (r.duplicate) result.duplicates += 1;
      else result.leads += 1;
    } catch (error) {
      result.errors += 1;
      warn(`leadgen ${item.leadgen_id} failed:`, error.message);
    }
  }
  return result;
};
