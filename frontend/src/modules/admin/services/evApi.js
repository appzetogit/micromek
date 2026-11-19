import api from '../../../shared/api/axiosInstance';
import { qs } from '../pages/platform/kit';

/// Admin EV fleet monitoring API (Backend/src/modules/ev). Every call resolves to
/// the response body `{ success, data }`.

const BASE = '/admin/ev';

export const getEvProvider = () => api.get(`${BASE}/provider`);
export const pollEvNow = () => api.post(`${BASE}/poll-now`);
export const syncEvVehicles = ({ dryRun = false } = {}) => api.post(`${BASE}/vehicles/sync`, { dry_run: dryRun });

export const getEvDashboard = (params = {}) => api.get(`${BASE}/dashboard${qs(params)}`);

export const listEvVehicles = (params = {}) => api.get(`${BASE}/vehicles${qs(params)}`);
export const createEvVehicle = (body) => api.post(`${BASE}/vehicles`, body);
export const getEvVehicle = (id) => api.get(`${BASE}/vehicles/${id}`);
export const updateEvVehicle = (id, body) => api.patch(`${BASE}/vehicles/${id}`, body);
export const deleteEvVehicle = (id) => api.delete(`${BASE}/vehicles/${id}`);
/** params: from, to (ISO), bucket = auto | raw | minutes. */
export const getEvTelemetry = (id, params = {}) => api.get(`${BASE}/vehicles/${id}/telemetry${qs(params)}`);

export const listEvTrips = (params = {}) => api.get(`${BASE}/trips${qs(params)}`);
export const getEvTrip = (id) => api.get(`${BASE}/trips/${id}`);

export const listEvAlerts = (params = {}) => api.get(`${BASE}/alerts${qs(params)}`);
export const acknowledgeEvAlert = (id) => api.post(`${BASE}/alerts/${id}/acknowledge`);
export const resolveEvAlert = (id, note) => api.post(`${BASE}/alerts/${id}/resolve`, note ? { note } : {});

export const getEvUtilisation = (params = {}) => api.get(`${BASE}/reports/utilisation${qs(params)}`);
/** Path for downloadFile(); the backend answers text/csv. */
export const evUtilisationCsvPath = (params = {}) => `${BASE}/reports/utilisation${qs({ ...params, format: 'csv' })}`;

/** Franchises for link pickers. */
export const listFranchiseOptions = () => api.get(`/admin/franchises${qs({ limit: 100 })}`);
