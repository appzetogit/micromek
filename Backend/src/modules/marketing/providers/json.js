/// Helpers for asking a text model for JSON and reading it back leniently.
/// The example is always the LAST thing in the prompt (the mock provider relies on that).
export const JSON_EXAMPLE_MARKER = 'Respond with only a JSON object shaped exactly like this example:';

export const jsonInstruction = (example) => `${JSON_EXAMPLE_MARKER}\n${JSON.stringify(example, null, 2)}`;

/// Parse the first {...} block in a model reply. Returns null if nothing parses.
export const parseJsonLoose = (text) => {
  const raw = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(raw); } catch { /* fall through */ }
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
};
