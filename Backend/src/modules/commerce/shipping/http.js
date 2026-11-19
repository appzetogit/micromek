import { ApiError } from '../../../utils/ApiError.js';

const DEFAULT_TIMEOUT_MS = Number(process.env.COMMERCE_SHIPPING_TIMEOUT_MS) || 15000;

/// JSON request with a hard timeout. Throws ApiError(502/504) carrying the provider's message.
export const requestJson = async (provider, url, { method = 'GET', headers = {}, body, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) => {
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    throw new ApiError(timedOut ? 504 : 502, `${provider} ${timedOut ? 'timed out' : 'unreachable'}`);
  }
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text.slice(0, 500) };
  }
  if (!response.ok) {
    const message = payload?.message || payload?.error || payload?.errors || `HTTP ${response.status}`;
    const err = new ApiError(502,`${provider}: ${typeof message === 'string' ? message : JSON.stringify(message)}`);
    err.providerStatus = response.status;
    throw err;
  }
  return payload;
};

export const disabled = (provider, envNames) =>
  new ApiError(503, `${provider} shipping is not configured (set ${envNames.join(', ')})`, { code: 'SHIPPING_PROVIDER_DISABLED' });
