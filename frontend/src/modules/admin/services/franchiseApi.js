import api from '../../../shared/api/axiosInstance';
import { qs } from '../pages/platform/kit';

// Franchises
export const listFranchises = (params) => api.get(`/admin/franchises${qs(params)}`);
export const getFranchise = (id, params) => api.get(`/admin/franchises/${id}${qs(params)}`);
export const createFranchise = (body) => api.post('/admin/franchises', body);
export const updateFranchise = (id, body) => api.patch(`/admin/franchises/${id}`, body);
/** action: approve | reject | suspend | reactivate */
export const setFranchiseStatus = (id, action, note) => api.post(`/admin/franchises/${id}/${action}`, { note });
export const deleteFranchise = (id) => api.delete(`/admin/franchises/${id}`);
export const getFranchiseLeaderboard = (params) => api.get(`/admin/franchises/leaderboard${qs(params)}`);

// Settlements
export const listSettlements = (params) => api.get(`/admin/franchise-settlements${qs(params)}`);
export const getSettlement = (id) => api.get(`/admin/franchise-settlements/${id}`);
export const generateSettlement = (body) => api.post('/admin/franchise-settlements', body);
export const refreshSettlement = (id) => api.post(`/admin/franchise-settlements/${id}/refresh`);
export const addSettlementAdjustment = (id, body) => api.post(`/admin/franchise-settlements/${id}/adjustments`, body);
/** action: approve | pay | cancel. pay needs { payment_reference, payment_mode }. */
export const transitionSettlement = (id, action, body = {}) =>
  api.post(`/admin/franchise-settlements/${id}/${action}`, body);

// Territory lookups (taxi admin): service locations return an array, zones { results }.
export const listServiceLocations = () => api.get('/admin/service-locations');
export const listZones = () => api.get('/admin/zones');
