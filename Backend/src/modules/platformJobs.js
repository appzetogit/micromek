import { registerLeaderJob, startLeaderElection } from './shared/leader.js';
import { startEvTelemetryLoop, stopEvTelemetryLoop } from './ev/services/evIngestService.js';
import { registerLeadEventListeners, startLeadJobs, stopLeadJobs } from './leads/index.js';
import { startCommerceJobs } from './commerce/routes/index.js';

let stopCommerce = null;

/// Background work for the platform modules. Call after Mongo is connected.
export const startPlatformJobs = () => {
  // Every process: events are in-process, so each one fires in the process
  // that handled the request and must be heard there.
  registerLeadEventListeners();

  // One process only (shared/leader.js): polling, sweeps, broadcasts.
  registerLeaderJob('ev-telemetry', startEvTelemetryLoop, stopEvTelemetryLoop);
  registerLeaderJob('lead-jobs', startLeadJobs, stopLeadJobs);
  registerLeaderJob(
    'commerce-jobs',
    () => { stopCommerce = startCommerceJobs(); },
    () => { if (typeof stopCommerce === 'function') stopCommerce(); stopCommerce = null; },
  );
  startLeaderElection();
};
