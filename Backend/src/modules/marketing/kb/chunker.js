/// Split text into ~`size` character chunks that overlap by ~`overlap`
/// characters, preferring paragraph / sentence / word boundaries.
export const CHUNK_SIZE = 800;
export const CHUNK_OVERLAP = 150;

export const normalizeText = (text) =>
  String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/// Light markdown clean-up: keep the words, drop link / image / emphasis syntax.
export const stripMarkdown = (md) =>
  String(md || '')
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```\w*/g, ''))
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/(\*\*|__|\*|_|`)/g, '')
    .replace(/^\s*[-*+]\s+/gm, '- ')
    .replace(/^\s*>\s?/gm, '');

export const chunkText = (text, { size = CHUNK_SIZE, overlap = CHUNK_OVERLAP } = {}) => {
  const clean = normalizeText(text);
  if (!clean) return [];
  if (clean.length <= size) return [clean];
  const chunks = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      const window = clean.slice(start, end);
      const boundary = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('. '), window.lastIndexOf('\n'));
      if (boundary > size * 0.5) end = start + boundary + 1;
      else {
        const space = window.lastIndexOf(' ');
        if (space > size * 0.5) end = start + space;
      }
    }
    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    let next = Math.max(end - overlap, start + 1);
    const space = clean.indexOf(' ', next);
    if (space !== -1 && space < end) next = space + 1;
    start = next;
  }
  return chunks;
};
