import { ApiError } from '../../../utils/ApiError.js';
import { normalizeText, stripMarkdown } from './chunker.js';

const MAX_CHARS = Number.parseInt(process.env.KB_MAX_DOCUMENT_CHARS || '', 10) || 500000;

/// ---------------------------------------------------------------------------
/// HOOK: server-side PDF extraction.
/// Not implemented (no PDF parsing dependency is installed). For now the admin
/// UI extracts the text in the browser (e.g. pdf.js) and posts it as `text`.
/// To add it: install a parser (e.g. `pdf-parse`), then implement this to
/// return the plain text of `buffer`; ingest will call it whenever a pdf is
/// posted with `content_base64` and no `text`.
/// ---------------------------------------------------------------------------
export const extractPdfText = async (buffer) => {
  void buffer;
  throw new ApiError(501, 'Server-side PDF extraction is not available yet; send the extracted text as `text`', {
    code: 'PDF_EXTRACTION_NOT_AVAILABLE',
  });
};

const normalizeFaqs = (faqs) => {
  let list = faqs;
  if (typeof list === 'string') {
    try { list = JSON.parse(list); } catch { throw new ApiError(400, 'faqs must be valid JSON'); }
  }
  if (list && !Array.isArray(list) && Array.isArray(list.faqs)) list = list.faqs;
  if (!Array.isArray(list) || !list.length) throw new ApiError(400, 'faqs must be a non-empty array of { question, answer }');
  return list.map((p, i) => {
    const question = String(p?.question ?? p?.q ?? '').trim();
    const answer = String(p?.answer ?? p?.a ?? '').trim();
    if (!question || !answer) throw new ApiError(400, `FAQ #${i + 1} needs both question and answer`);
    return { question, answer };
  });
};

/// Turn a request body into { content, faqs?, sections }.
/// `sections` are pieces that must not be merged (FAQ pairs); each is chunked on its own.
export const extractDocument = async ({ format = 'text', text, faqs, content_base64: base64 }) => {
  let content = '';
  let pairs;
  if (format === 'faq_json') {
    pairs = normalizeFaqs(faqs ?? text);
    content = pairs.map((p) => `Q: ${p.question}\nA: ${p.answer}`).join('\n\n');
  } else if (format === 'markdown') {
    content = normalizeText(stripMarkdown(text));
  } else if (format === 'pdf') {
    if (typeof text === 'string' && text.trim()) content = normalizeText(text);
    else if (base64) content = normalizeText(await extractPdfText(Buffer.from(String(base64), 'base64')));
  } else {
    content = normalizeText(text);
  }
  if (!content) throw new ApiError(400, 'Document has no text to index');
  if (content.length > MAX_CHARS) throw new ApiError(413, `Document is too large (max ${MAX_CHARS} characters)`);
  const sections = pairs ? pairs.map((p) => `Q: ${p.question}\nA: ${p.answer}`) : [content];
  return { content, faqs: pairs, sections };
};
