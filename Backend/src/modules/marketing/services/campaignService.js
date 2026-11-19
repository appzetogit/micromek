import mongoose from 'mongoose';
import { ApiError } from '../../../utils/ApiError.js';
import { CALL_TO_ACTIONS, CAMPAIGN_EDITABLE, CAMPAIGN_OBJECTIVES, CAMPAIGN_TRANSITIONS } from '../constants.js';
import { AdCampaignDraft } from '../models/AdCampaignDraft.js';
import { generateText } from '../providers/index.js';
import { jsonInstruction, parseJsonLoose } from '../providers/json.js';
import { getPublisher } from '../publishers/index.js';
import {
  adminObjectId, assertObjectId, assertReviewer, dateOrNull, envInt, historyEntry, modelIfRegistered, nonNegNumber, oneOf,
  str, toObjectIds,
} from './util.js';

const OPTIMIZATION = {
  OUTCOME_AWARENESS: 'REACH',
  OUTCOME_TRAFFIC: 'LINK_CLICKS',
  OUTCOME_ENGAGEMENT: 'POST_ENGAGEMENT',
  OUTCOME_LEADS: 'LEAD_GENERATION',
  OUTCOME_SALES: 'OFFSITE_CONVERSIONS',
  OUTCOME_APP_PROMOTION: 'APP_INSTALLS',
};
const CTA_BY_OBJECTIVE = {
  OUTCOME_AWARENESS: 'LEARN_MORE',
  OUTCOME_TRAFFIC: 'LEARN_MORE',
  OUTCOME_ENGAGEMENT: 'WHATSAPP_MESSAGE',
  OUTCOME_LEADS: 'SIGN_UP',
  OUTCOME_SALES: 'SHOP_NOW',
  OUTCOME_APP_PROMOTION: 'LEARN_MORE',
};

/// Map a free-text goal onto a Meta campaign objective.
export const objectiveForGoal = (goal = '') => {
  const g = String(goal).toLowerCase();
  if (/lead|enquir|inquir|sign.?up|registration|form/.test(g)) return 'OUTCOME_LEADS';
  if (/sale|sell|purchase|order|buy|revenue|convert/.test(g)) return 'OUTCOME_SALES';
  if (/app install|download/.test(g)) return 'OUTCOME_APP_PROMOTION';
  if (/engag|like|follow|comment|message|whatsapp|chat/.test(g)) return 'OUTCOME_ENGAGEMENT';
  if (/aware|reach|launch|brand|visibility/.test(g)) return 'OUTCOME_AWARENESS';
  if (/traffic|visit|website|store|click/.test(g)) return 'OUTCOME_TRAFFIC';
  return 'OUTCOME_TRAFFIC';
};

const normalizeBudget = (budget) => {
  if (budget === undefined || budget === null) return { kind: 'daily', amount: 0, currency: 'INR' };
  if (typeof budget === 'number' || typeof budget === 'string') {
    return { kind: 'daily', amount: nonNegNumber(budget, 'budget') ?? 0, currency: 'INR' };
  }
  return {
    kind: oneOf(budget.kind ?? budget.type, ['daily', 'lifetime'], 'budget.kind', 'daily'),
    amount: nonNegNumber(budget.amount, 'budget.amount') ?? 0,
    currency: str(budget.currency, { label: 'budget.currency', max: 3 }).toUpperCase() || 'INR',
  };
};

/// Rule-based advice that needs no AI.
export const budgetRecommendations = ({ objective, budget, schedule }) => {
  const recs = [];
  const minDaily = envInt('MKT_MIN_DAILY_BUDGET', 300);
  const days = schedule?.start_at && schedule?.end_at
    ? Math.max(1, Math.ceil((schedule.end_at - schedule.start_at) / 86400000))
    : null;
  const daily = budget.kind === 'daily' ? budget.amount : (days ? budget.amount / days : null);
  if (!budget.amount) recs.push({ kind: 'budget', severity: 'warning', message: 'Set a budget before approval.' });
  else if (daily !== null && daily < minDaily) {
    recs.push({ kind: 'budget', severity: 'warning', message: `About ${Math.round(daily)} ${budget.currency}/day is below the suggested minimum of ${minDaily}; delivery and learning will be slow.` });
  }
  if (days !== null && days < 7) recs.push({ kind: 'schedule', severity: 'info', message: 'Run for at least 7 days so the ad set can leave the learning phase before you judge results.' });
  if (objective === 'OUTCOME_SALES') recs.push({ kind: 'objective', severity: 'info', message: 'Sales optimisation needs the Meta Pixel / Conversions API with purchase events; without it, use Traffic or Leads.' });
  if (objective === 'OUTCOME_LEADS') recs.push({ kind: 'objective', severity: 'info', message: 'Instant Forms leads arrive through the leads module webhook; keep the form short (name + phone).' });
  recs.push({ kind: 'creative', severity: 'info', message: 'Test 2-3 copy variations per ad and pause the weakest after about 1,000 impressions each.' });
  return recs;
};

const buildAdSets = (objective, budget, audience) => {
  const minDaily = envInt('MKT_MIN_DAILY_BUDGET', 300);
  const split = budget.kind === 'daily' && budget.amount >= 2 * minDaily;
  const optimization_goal = OPTIMIZATION[objective];
  const sets = [{
    name: 'Core audience',
    audience_description: audience || 'People in your service area, 18-55, broad interests',
    targeting: { geo_locations: { countries: ['IN'] }, age_min: 18, age_max: 55 },
    budget_share: split ? 60 : 100,
    optimization_goal,
    placements: ['facebook_feed', 'instagram_feed', 'instagram_stories'],
  }];
  if (split) {
    sets.push({
      name: 'Retargeting',
      audience_description: 'Website visitors, page / Instagram engagers and WhatsApp contacts from the last 30 days',
      targeting: { custom_audiences: ['<engagers_30d>'] },
      budget_share: 40,
      optimization_goal,
      placements: ['facebook_feed', 'instagram_feed'],
    });
  }
  return sets;
};

const loadProducts = async (ids) => {
  if (!ids.length) return [];
  const Product = modelIfRegistered(mongoose, 'CommerceProduct');
  if (!Product) return [];
  return Product.find({ _id: { $in: ids } }).select('name brand price mrp description').lean();
};

/// Produce an AdCampaignDraft (never published) from a goal + budget + products.
export const recommendCampaign = async (body = {}, { auth, actor }) => {
  const goal = str(body.goal, { label: 'goal', max: 500, required: true });
  const objective = body.objective ? oneOf(body.objective, CAMPAIGN_OBJECTIVES, 'objective') : objectiveForGoal(goal);
  const budget = normalizeBudget(body.budget);
  const productIds = toObjectIds(body.product_ids || []);
  const products = await loadProducts(productIds);
  const audience = str(body.audience, { label: 'audience', max: 1000 });
  const schedule = { start_at: dateOrNull(body.start_at, 'start_at'), end_at: dateOrNull(body.end_at, 'end_at') };
  const cta = CTA_BY_OBJECTIVE[objective];

  const example = {
    audience_description: 'Who to target and why, in one sentence',
    ads: [1, 2, 3].map((n) => ({ headline: `Headline ${n}`, primary_text: `Primary text ${n}`, description: `Description ${n}` })),
  };
  const productLines = products.length
    ? products.map((p) => `- ${p.name}: Rs ${p.price}${p.mrp > p.price ? ` (MRP Rs ${p.mrp})` : ''}. ${String(p.description || '').slice(0, 200)}`).join('\n')
    : '- (no specific products)';
  const prompt = [
    `Campaign goal: ${goal}`,
    `Meta objective: ${objective}`,
    `Budget: ${budget.amount} ${budget.currency} (${budget.kind})`,
    audience ? `Audience notes: ${audience}` : '',
    `Products:\n${productLines}`,
    'Write 3 ad copy variations (headline under 40 chars, primary text under 125 chars, description under 30 chars).',
    jsonInstruction(example),
  ].filter(Boolean).join('\n');
  const res = await generateText({
    system: 'You are a Meta Ads strategist for an Indian retail / wholesale business. Do not invent offers or prices. Output is a draft reviewed by a human.',
    prompt,
    maxTokens: 700,
    purpose: 'campaign_recommend',
    actor,
  });
  const parsed = parseJsonLoose(res.text) || {};
  const copies = (Array.isArray(parsed.ads) ? parsed.ads : []).map((a) => ({
    headline: String(a?.headline || '').slice(0, 200),
    primary_text: String(a?.primary_text || '').slice(0, 1000),
    description: String(a?.description || '').slice(0, 200),
  })).filter((c) => c.headline || c.primary_text);
  if (!copies.length) copies.push({ headline: goal.slice(0, 40), primary_text: res.text.slice(0, 1000), description: '' });

  const adSets = buildAdSets(objective, budget, audience || String(parsed.audience_description || ''));
  const ads = adSets.map((set, i) => ({
    name: `${set.name} - ad`,
    ad_set_index: i,
    ...copies[0],
    call_to_action: cta,
    variations: copies.slice(1),
  }));

  return AdCampaignDraft.create({
    name: str(body.name, { label: 'name', max: 200 }) || `${goal.slice(0, 60)} (${new Date().toISOString().slice(0, 10)})`,
    goal,
    objective,
    audience: { description: audience || String(parsed.audience_description || ''), targeting: adSets[0].targeting },
    budget,
    schedule,
    product_ids: productIds,
    ad_sets: adSets,
    ads,
    recommendations: budgetRecommendations({ objective, budget, schedule }),
    status: 'draft',
    ai_generated: true,
    ai_prompt: prompt,
    ai_meta: { provider: res.provider, model: res.model },
    created_by: adminObjectId(auth),
    history: [historyEntry('ai_recommend', '', 'draft', auth)],
  });
};

// ---------- CRUD / workflow ----------

export const getCampaignOr404 = async (id) => {
  const c = await AdCampaignDraft.findById(assertObjectId(id, 'campaign id'));
  if (!c) throw new ApiError(404, 'Campaign draft not found');
  return c;
};

const normalizeAds = (ads) => (Array.isArray(ads) ? ads : []).slice(0, 50).map((a) => ({
  name: str(a?.name, { label: 'ad name', max: 200 }),
  ad_set_index: Number.parseInt(a?.ad_set_index, 10) || 0,
  headline: str(a?.headline, { label: 'headline', max: 200 }),
  primary_text: str(a?.primary_text, { label: 'primary_text', max: 2000 }),
  description: str(a?.description, { label: 'description', max: 200 }),
  call_to_action: oneOf(a?.call_to_action, CALL_TO_ACTIONS, 'call_to_action', 'LEARN_MORE'),
  media_urls: Array.isArray(a?.media_urls) ? a.media_urls.map(String).slice(0, 10) : [],
  link_url: str(a?.link_url, { label: 'link_url', max: 2000 }),
  variations: (Array.isArray(a?.variations) ? a.variations : []).slice(0, 10).map((v) => ({
    headline: str(v?.headline, { label: 'headline', max: 200 }),
    primary_text: str(v?.primary_text, { label: 'primary_text', max: 2000 }),
    description: str(v?.description, { label: 'description', max: 200 }),
  })),
}));

const normalizeAdSets = (sets) => (Array.isArray(sets) ? sets : []).slice(0, 20).map((s) => ({
  name: str(s?.name, { label: 'ad set name', max: 200 }),
  audience_description: str(s?.audience_description, { label: 'audience_description', max: 1000 }),
  targeting: s?.targeting && typeof s.targeting === 'object' ? s.targeting : {},
  budget_share: Math.min(100, Math.max(0, Number(s?.budget_share ?? 100) || 0)),
  optimization_goal: str(s?.optimization_goal, { label: 'optimization_goal', max: 60 }),
  placements: Array.isArray(s?.placements) ? s.placements.map(String).slice(0, 20) : [],
}));

const campaignFields = (body, { partial }) => {
  const out = {};
  if (!partial || body.name !== undefined) out.name = str(body.name, { label: 'name', max: 200, required: true });
  if (body.goal !== undefined) out.goal = str(body.goal, { label: 'goal', max: 500 });
  if (body.objective !== undefined || !partial) out.objective = oneOf(body.objective, CAMPAIGN_OBJECTIVES, 'objective', objectiveForGoal(body.goal));
  if (body.audience !== undefined) {
    out.audience = {
      description: str(body.audience?.description ?? (typeof body.audience === 'string' ? body.audience : ''), { label: 'audience.description', max: 1000 }),
      targeting: body.audience?.targeting && typeof body.audience.targeting === 'object' ? body.audience.targeting : {},
    };
  }
  if (body.budget !== undefined) out.budget = normalizeBudget(body.budget);
  if (body.schedule !== undefined) {
    out.schedule = { start_at: dateOrNull(body.schedule?.start_at, 'schedule.start_at'), end_at: dateOrNull(body.schedule?.end_at, 'schedule.end_at') };
    if (out.schedule.start_at && out.schedule.end_at && out.schedule.end_at <= out.schedule.start_at) {
      throw new ApiError(400, 'schedule.end_at must be after start_at');
    }
  }
  if (body.product_ids !== undefined) out.product_ids = toObjectIds(body.product_ids);
  if (body.ad_sets !== undefined) out.ad_sets = normalizeAdSets(body.ad_sets);
  if (body.ads !== undefined) out.ads = normalizeAds(body.ads);
  return out;
};

export const createCampaign = async (body, auth) => {
  const data = campaignFields(body, { partial: false });
  return AdCampaignDraft.create({
    ...data,
    recommendations: budgetRecommendations({ objective: data.objective, budget: data.budget || normalizeBudget(), schedule: data.schedule }),
    status: 'draft',
    created_by: adminObjectId(auth),
    history: [historyEntry('create', '', 'draft', auth)],
  });
};

export const updateCampaign = async (c, body, auth) => {
  if (!CAMPAIGN_EDITABLE.includes(c.status)) {
    throw new ApiError(409, `Campaign in status "${c.status}" cannot be edited; reject it first`, { code: 'NOT_EDITABLE' });
  }
  const from = c.status;
  c.set(campaignFields(body, { partial: true }));
  c.recommendations = budgetRecommendations({ objective: c.objective, budget: c.budget, schedule: c.schedule });
  c.status = 'draft';
  c.history.push(historyEntry('edit', from, 'draft', auth));
  await c.save();
  return c;
};

export const deleteCampaign = async (c) => {
  if (!CAMPAIGN_EDITABLE.includes(c.status)) throw new ApiError(409, 'Only draft or rejected campaigns can be deleted');
  await c.deleteOne();
};

export const transitionCampaign = async (c, action, body = {}, auth) => {
  const rule = CAMPAIGN_TRANSITIONS[action];
  if (!rule) throw new ApiError(400, `Unknown action ${action}`);
  if (rule.reviewer) assertReviewer(auth, `${action} campaigns`);
  if (!rule.from.includes(c.status)) {
    throw new ApiError(409, `Cannot ${action} a campaign in status "${c.status}"`, { code: 'INVALID_TRANSITION' });
  }
  const note = str(body.notes ?? body.note, { label: 'notes', max: 2000 });
  if (action === 'reject' && !note) throw new ApiError(400, 'notes are required when rejecting');
  if (action === 'approve') {
    if (!c.budget?.amount) throw new ApiError(400, 'Set a budget before approving');
    if (!c.ads?.length) throw new ApiError(400, 'Add at least one ad before approving');
  }
  const from = c.status;
  c.status = rule.to;
  if (rule.reviewer) {
    c.reviewer = adminObjectId(auth);
    c.reviewed_at = new Date();
    c.review_notes = note;
  }
  c.history.push(historyEntry(action, from, rule.to, auth, note));
  await c.save();
  return c;
};

export const publishCampaign = async (c, auth) => {
  if (c.status !== 'approved') throw new ApiError(409, 'Only approved campaigns can be published', { code: 'NOT_APPROVED' });
  const publisher = getPublisher();
  const result = await publisher.publishCampaign(c.toObject());
  c.status = 'published';
  c.publish = { publisher: publisher.name, external_id: String(result?.external_id || ''), raw: result?.raw, published_at: new Date(), last_attempt_at: new Date(), attempts: (c.publish?.attempts || 0) + 1 };
  c.history.push(historyEntry('publish', 'approved', 'published', auth, publisher.name));
  await c.save();
  return c;
};

// ---------- performance ----------

/// Rule-based improvement suggestions from (manually entered) metrics.
export const suggestImprovements = (m = {}, objective = '') => {
  const out = [];
  const impressions = m.impressions || 0;
  if (impressions < 1000) {
    out.push({ kind: 'performance', severity: 'info', message: 'Fewer than 1,000 impressions: too early to judge, let it run.' });
    return out;
  }
  const ctr = (m.clicks || 0) / impressions;
  if (ctr < 0.008) out.push({ kind: 'creative', severity: 'warning', message: `CTR is ${(ctr * 100).toFixed(2)}% (below 0.8%): refresh the image / headline or tighten the audience.` });
  else out.push({ kind: 'creative', severity: 'info', message: `CTR is ${(ctr * 100).toFixed(2)}%: creative is working; scale budget by 20% steps.` });
  if (m.clicks > 100 && objective === 'OUTCOME_LEADS' && !m.leads) out.push({ kind: 'performance', severity: 'warning', message: 'Clicks but no leads: check the form / landing page and the lead webhook.' });
  if (m.leads > 0 && m.spend) out.push({ kind: 'performance', severity: 'info', message: `Cost per lead is ${(m.spend / m.leads).toFixed(0)}.` });
  if (m.revenue !== null && m.revenue !== undefined && m.spend) {
    const roas = m.revenue / m.spend;
    out.push({ kind: 'performance', severity: roas < 1 ? 'warning' : 'info', message: `ROAS is ${roas.toFixed(2)}x${roas < 1 ? ': spending more than it returns, reduce budget or retarget.' : '.'}` });
  }
  return out;
};

export const recordMetrics = async (c, body = {}) => {
  const keys = ['impressions', 'clicks', 'spend', 'leads', 'purchases', 'revenue'];
  const metrics = Object.fromEntries(keys.map((k) => [k, nonNegNumber(body[k], k)]));
  c.metrics = { ...metrics, updated_at: new Date() };
  c.performance_suggestions = suggestImprovements(metrics, c.objective);
  await c.save();
  return c;
};
