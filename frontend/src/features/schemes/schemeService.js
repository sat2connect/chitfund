import { apiRequest, toQuery } from '../../services/apiClient.js';

const post = (path, body) => apiRequest(path, { method: 'POST', body });

export const getSchemeMeta = (signal) => apiRequest('/schemes/meta', { signal });
export const listSchemes = (p, signal) => apiRequest(`/schemes${toQuery(p)}`, { signal });
export const getScheme = (id, signal) => apiRequest(`/schemes/${id}`, { signal });
export const createScheme = (body) => post('/schemes', body);
export const createSchemeVersion = (id) => post(`/schemes/${id}/versions`);
export const updateSchemeVersion = (id, body) => apiRequest(`/scheme-versions/${id}`, { method: 'PUT', body });
export const submitSchemeVersion = (id) => post(`/scheme-versions/${id}/submit`);
export const withdrawSchemeVersion = (id) => post(`/scheme-versions/${id}/withdraw`);
export const publishSchemeVersion = (id) => post(`/scheme-versions/${id}/publish`);
export const retireSchemeVersion = (id, body) => post(`/scheme-versions/${id}/retire`, body);
export const listPublishedVersions = (signal) => apiRequest('/schemes/published-versions', { signal });

export const listGroups = (p, signal) => apiRequest(`/groups${toQuery(p)}`, { signal });
export const getGroup = (id, signal) => apiRequest(`/groups/${id}`, { signal });
export const createGroup = (body) => post('/groups', body);
export const updateGroup = (id, body) => apiRequest(`/groups/${id}`, { method: 'PUT', body });
export const groupAction = (id, action, body) => post(`/groups/${id}/${action}`, body);
export const addGroupDocument = (id, body) => post(`/groups/${id}/documents`, body);
export const allocateTicket =(id, body) => post(`/groups/${id}/tickets`, body);
export const releaseTicket = (id, no, body) => post(`/groups/${id}/tickets/${no}/release`, body);
export const confirmChecklistItem = (id, itemId, body) => post(`/groups/${id}/checklist/${itemId}/confirm`, body);

export const getCalculationRules = (signal) => apiRequest('/calculations/rules', { signal });
export const previewCalculation = (body) => post('/calculations/preview', body);

export const listApprovals =(p, signal) => apiRequest(`/approvals${toQuery(p)}`, { signal });
export const startApprovalReview = (id) => post(`/approvals/${id}/start-review`);
export const decideApproval = (id, body) => post(`/approvals/${id}/decision`, body);
