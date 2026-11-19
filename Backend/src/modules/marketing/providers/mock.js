import { JSON_EXAMPLE_MARKER } from './json.js';

/// Deterministic stand-in for dev and tests. No network, no randomness:
///  - generateText echoes a condensed prompt, or, when the prompt ends with a
///    JSON example (see json.js), returns that example with every string tagged.
///  - embed uses a hashed bag-of-words vector, so similar wording => similar vectors
///    and retrieval / thresholds can be tested for real.
export const MOCK_EMBED_DIM = 512;

const STOPWORDS = new Set(
  ('a an and are as at be but by can do does for from has have how i if in into is it its me my no not of on or our '
    + 'so than that the their them there these they this to too up us was we what when where which who why will with '
    + 'you your yours about any all also am been being did get got just more most much only other some such then very')
    .split(' '),
);

export const fnv1a = (str) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
};

const stem = (t) => {
  if (t.length > 5 && t.endsWith('ing')) return t.slice(0, -3);
  if (t.length > 4 && t.endsWith('ed')) return t.slice(0, -2);
  if (t.length > 4 && t.endsWith('es')) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
};

export const tokenize = (text) =>
  String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
    .map(stem);

export const hashedVector = (text, dim = MOCK_EMBED_DIM) => {
  const v = new Array(dim).fill(0);
  for (const token of tokenize(text)) v[fnv1a(token) % dim] += 1;
  const norm = Math.sqrt(v.reduce((a, x) => a + x * x, 0));
  return norm ? v.map((x) => Number((x / norm).toFixed(6))) : v;
};

const tagStrings = (value, tag) => {
  if (typeof value === 'string') return `${value} [${tag}]`;
  if (Array.isArray(value)) return value.map((v) => tagStrings(v, tag));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, tagStrings(v, tag)]));
  }
  return value;
};

export const mockProvider = Object.freeze({
  name: 'mock',
  configured: true,
  model: 'mock-text-1',
  embeddingModel: `mock-bow-${MOCK_EMBED_DIM}`,
  async generateText({ system = '', prompt = '' }) {
    const tag = `mock-${fnv1a(`${system}\n${prompt}`).toString(16).padStart(8, '0').slice(0, 6)}`;
    const at = prompt.lastIndexOf(JSON_EXAMPLE_MARKER);
    if (at !== -1) {
      try {
        const example = JSON.parse(prompt.slice(at + JSON_EXAMPLE_MARKER.length));
        return { text: JSON.stringify(tagStrings(example, tag)), model: this.model };
      } catch { /* not JSON after the marker: fall through to plain text */ }
    }
    const condensed = prompt.replace(/\s+/g, ' ').trim().slice(0, 280);
    return { text: `[${tag}] ${condensed}`, model: this.model };
  },
  async embed(texts) {
    return { vectors: texts.map((t) => hashedVector(t)), model: this.embeddingModel };
  },
});
