import { DisabledProvider } from './baseProvider.js';
import { createMockProvider } from './mockProvider.js';
import { createGenericRestProvider } from './genericRestProvider.js';

/// Provider registry. Add a vendor by writing `providers/<vendor>Provider.js`
/// (extend EvTelemetryProvider) and registering its factory here; then set
/// EV_PROVIDER=<key>.
export const PROVIDER_FACTORIES = {
  mock: () => createMockProvider(),
  generic_rest: () => createGenericRestProvider(process.env),
};

let cached = null;

/// Picks the provider from EV_PROVIDER. Unset → 'mock' outside production,
/// disabled in production (so a forgotten env var never shows fake data live).
/// EV_PROVIDER=none (or off/disabled) turns telemetry off explicitly.
export const resolveProvider = (env = process.env) => {
  const configured = String(env.EV_PROVIDER || '').trim().toLowerCase();
  const isProd = env.NODE_ENV === 'production';
  if (!configured) {
    return isProd
      ? new DisabledProvider('none', 'EV telematics is disabled: set EV_PROVIDER (e.g. generic_rest) in production')
      : PROVIDER_FACTORIES.mock();
  }
  if (['none', 'off', 'disabled'].includes(configured)) {
    return new DisabledProvider('none', 'EV telematics is disabled (EV_PROVIDER=none)');
  }
  const factory = PROVIDER_FACTORIES[configured];
  if (!factory) {
    return new DisabledProvider(configured, `Unknown EV_PROVIDER "${configured}". Known: ${Object.keys(PROVIDER_FACTORIES).join(', ')}`);
  }
  if (configured === 'mock' && isProd && env.EV_ALLOW_MOCK_IN_PRODUCTION !== 'true') {
    return new DisabledProvider('mock', 'The mock EV provider is blocked in production (set EV_ALLOW_MOCK_IN_PRODUCTION=true to override)');
  }
  try {
    return factory();
  } catch (error) {
    return new DisabledProvider(configured, `EV provider "${configured}" is misconfigured: ${error.message}`);
  }
};

export const getProvider = () => {
  if (!cached) cached = resolveProvider();
  return cached;
};

/// For tests or after changing env at runtime.
export const resetProvider = () => {
  cached = null;
};
