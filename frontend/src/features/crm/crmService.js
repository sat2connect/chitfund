import { apiRequest, toQuery } from '../../services/apiClient.js';

export const getMeta = (signal) => apiRequest('/crm/meta', { signal });

export const listLeads = (p, signal) => apiRequest(`/leads${toQuery(p)}`, { signal });
export const getLead = (id, signal) => apiRequest(`/leads/${id}`, { signal });
export const createLead = (body) => apiRequest('/leads', { method: 'POST', body });
export const transitionLead = (id, body) => apiRequest(`/leads/${id}/transition`, { method: 'POST', body });
export const addLeadNote = (id, body) => apiRequest(`/leads/${id}/activities`, { method: 'POST', body });
export const addFollowUp = (id, body) => apiRequest(`/leads/${id}/follow-ups`, { method: 'POST', body });
export const convertLead = (id, body) => apiRequest(`/leads/${id}/convert`, { method: 'POST', body });
export const listFollowUps = (p, signal) => apiRequest(`/follow-ups${toQuery(p)}`, { signal });
export const completeFollowUp = (id) => apiRequest(`/follow-ups/${id}/complete`, { method: 'POST' });

export const listCustomers = (p, signal) => apiRequest(`/customers${toQuery(p)}`, { signal });
export const createCustomer = (body) => apiRequest('/customers', { method: 'POST', body });
export const getCustomer = (id, signal) => apiRequest(`/customers/${id}`, { signal });

export const createApplication = (body) => apiRequest('/memberships/applications', { method: 'POST', body });
