import { apiRequest, toQuery } from '../../services/apiClient.js';

export const listKyc = (p, signal) => apiRequest(`/kyc-cases${toQuery(p)}`, { signal });
export const getKyc = (id, signal) => apiRequest(`/kyc-cases/${id}`, { signal });
export const addKycDocument = (id, body) => apiRequest(`/kyc-cases/${id}/documents`, { method: 'POST', body });
export const submitKyc = (id) => apiRequest(`/kyc-cases/${id}/submit`, { method: 'POST' });
export const decideKyc = (id, body) => apiRequest(`/kyc-cases/${id}/decision`, { method: 'POST', body });

export const listApplications = (p, signal) => apiRequest(`/memberships/applications${toQuery(p)}`, { signal });
export const decideApplication = (id, body) => apiRequest(`/memberships/applications/${id}/decision`, { method: 'POST', body });
