import { ApiError } from '../../../utils/ApiError.js';
import { AiUsage } from '../models/AiUsage.js';
import { disabledProvider } from './disabled.js';
import { mockProvider } from './mock.js';

/// AI provider registry + the only two functions the rest of the module calls:
///   generateText({ system, prompt, maxTokens, purpose, actor }) -> { text, provider, model }
///   embed(texts, { purpose, actor })                          -> { vectors, provider, model }
/// Both enforce AI_DAILY_CALL_LIMIT and write one AiUsage row per call.
///
/// A provider implementation is an object:
///   { name, configured: true, model, embeddingModel,
///     generateText({ system, prompt, maxTokens }) -> { text, model?, usage?: { input_tokens, output_tokens } },
///     embed(texts[]) -> { vectors: number[][], model?, usage?: { input_tokens } } }
/// Register it with registerAiProvider() and select it with AI_PROVIDER=<name>.

const registry = new Map([
  ['disabled', disabledProvider],
  ['mock', mockProvider],
]);
const warned = new Set();

export const registerAiProvider = (name, impl) => {
  registry.set(String(name).toLowerCase(), impl);
};

export const providerName = () => {
  const raw = String(process.env.AI_PROVIDER || '').trim().toLowerCase();
  if (raw) return raw;
  return process.env.NODE_ENV === 'production' ? 'disabled' : 'mock';
};

export const getProvider = () => {
  const name = providerName();
  const impl = registry.get(name);
  if (impl) return impl;
  if (!warned.has(name)) {
    warned.add(name);
    console.warn(`[marketing/ai] AI_PROVIDER="${name}" is not registered; using the disabled provider`);
  }
  return disabledProvider;
};

export const dailyCallLimit = () => {
  const n = Number.parseInt(process.env.AI_DAILY_CALL_LIMIT ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : 500; // 0 = unlimited
};

const startOfUtcDay = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export const callsToday = () => AiUsage.countDocuments({ ok: true, createdAt: { $gte: startOfUtcDay() } });

const assertConfigured = (provider) => {
  if (!provider.configured) {
    throw new ApiError(503, 'No AI provider is configured', { code: 'AI_PROVIDER_NOT_CONFIGURED' });
  }
};

/// Note: count-then-call is not atomic, so concurrent requests can overshoot by a few calls.
const assertUnderLimit = async () => {
  const limit = dailyCallLimit();
  if (!limit) return;
  const used = await callsToday();
  if (used >= limit) {
    throw new ApiError(429, 'Daily AI call limit reached', { code: 'AI_DAILY_LIMIT_REACHED', limit, used });
  }
};

const actorFields = (actor) => ({
  kind: actor?.kind === 'admin' ? 'admin' : 'system',
  id: actor?.id ? String(actor.id) : '',
  name: actor?.name || '',
});

const estimateTokens = (chars) => Math.ceil(chars / 4);

const record = (row) =>
  AiUsage.create(row).catch((error) => console.warn('[marketing/ai] usage log failed', error.message));

const run = async (operation, provider, { purpose, actor, inputChars, items }, fn) => {
  assertConfigured(provider);
  await assertUnderLimit();
  const started = Date.now();
  const base = {
    provider: provider.name,
    operation,
    purpose: purpose || 'unspecified',
    triggered_by: actorFields(actor),
    input_chars: inputChars,
    items,
  };
  try {
    const result = await fn();
    const outputChars = operation === 'text' ? String(result.text || '').length : 0;
    const usage = result.usage || {};
    const reported = Number.isFinite(usage.input_tokens);
    await record({
      ...base,
      model: result.model || (operation === 'text' ? provider.model : provider.embeddingModel) || '',
      output_chars: outputChars,
      input_tokens: reported ? usage.input_tokens : estimateTokens(inputChars),
      output_tokens: Number.isFinite(usage.output_tokens) ? usage.output_tokens : estimateTokens(outputChars),
      tokens_estimated: !reported,
      cost_estimate: Number.isFinite(result.cost_estimate) ? result.cost_estimate : null,
      ok: true,
      duration_ms: Date.now() - started,
    });
    return result;
  } catch (error) {
    await record({
      ...base,
      ok: false,
      error_code: error.details?.code || error.code || error.name || 'ERROR',
      duration_ms: Date.now() - started,
    });
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, `AI provider error: ${error.message}`, { code: 'AI_PROVIDER_ERROR' });
  }
};

export const generateText = async ({ system = '', prompt = '', maxTokens = 600, purpose, actor } = {}) => {
  const provider = getProvider();
  const result = await run(
    'text',
    provider,
    { purpose, actor, inputChars: system.length + prompt.length, items: 1 },
    () => provider.generateText({ system, prompt, maxTokens }),
  );
  return { text: String(result.text || '').trim(), provider: provider.name, model: result.model || provider.model };
};

export const embed = async (texts = [], { purpose, actor } = {}) => {
  const provider = getProvider();
  const list = texts.map((t) => String(t || ''));
  if (!list.length) return { vectors: [], provider: provider.name, model: provider.embeddingModel };
  const result = await run(
    'embed',
    provider,
    { purpose, actor, inputChars: list.reduce((a, t) => a + t.length, 0), items: list.length },
    () => provider.embed(list),
  );
  if (!Array.isArray(result.vectors) || result.vectors.length !== list.length) {
    throw new ApiError(502, 'AI provider returned the wrong number of embeddings', { code: 'AI_PROVIDER_ERROR' });
  }
  return { vectors: result.vectors, provider: provider.name, model: result.model || provider.embeddingModel };
};

/// The embedding model id stored on chunks. Chunks embedded with another model are ignored until reindexed.
export const currentEmbeddingModel = () => {
  const p = getProvider();
  return p.configured ? `${p.name}:${p.embeddingModel}` : '';
};

export const providerStatus = async () => {
  const p = getProvider();
  const limit = dailyCallLimit();
  return {
    provider: p.name,
    requested: providerName(),
    configured: !!p.configured,
    model: p.model || null,
    embedding_model: p.embeddingModel || null,
    daily_call_limit: limit || null,
    calls_today: await callsToday(),
    registered: [...registry.keys()],
  };
};
