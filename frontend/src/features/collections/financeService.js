import { apiRequest, toQuery } from '../../services/apiClient.js';

const post = (path, body) => apiRequest(path, { method: 'POST', body });

// Collections
export const getPaymentMeta = (signal) => apiRequest('/payments/meta', { signal });
export const listInstalments = (p, signal) => apiRequest(`/instalments${toQuery(p)}`, { signal });
export const getInstalmentSummary = (p, signal) => apiRequest(`/instalments/summary${toQuery(p)}`, { signal });
export const listArrears = (p, signal) => apiRequest(`/instalments/arrears${toQuery(p)}`, { signal });
export const recordOffline = (body) => post('/payments/offline', body);
export const listPayments = (p, signal) => apiRequest(`/payments${toQuery(p)}`, { signal });
export const getPayment = (id, signal) => apiRequest(`/payments/${id}`, { signal });
export const requestPaymentReversal = (id, body) => post(`/payments/${id}/reversal-request`, body);
export const listReceipts = (p, signal) => apiRequest(`/receipts${toQuery(p)}`, { signal });
export const initiateOnline = (body) => post('/payment-attempts', body);
export const listAttempts = (p, signal) => apiRequest(`/payment-attempts${toQuery(p)}`, { signal });
export const cancelAttempt = (id) => post(`/payment-attempts/${id}/cancel`);
export const simulateCallback = (id, body) => post(`/payment-attempts/${id}/simulated-callback`, body);

// Reconciliation
export const getReconQueue = (p, signal) => apiRequest(`/reconciliation/queue${toQuery(p)}`, { signal });
export const listBankLines = (p, signal) => apiRequest(`/reconciliation/bank-lines${toQuery(p)}`, { signal });
export const importBankLines = (body) => post('/reconciliation/bank-lines', body);
export const matchPayment = (body) => post('/reconciliation/match', body);
export const listReconResults = (signal) => apiRequest('/reconciliation/results', { signal });

// Accounting
export const listAccounts = (signal) => apiRequest('/accounting/accounts', { signal });
export const createAccount = (body) => post('/accounting/accounts', body);
export const setAccountActive = (id, active) => post(`/accounting/accounts/${id}/active`, { active });
export const listPeriods = (signal) => apiRequest('/accounting/periods', { signal });
export const closePeriod = (id) => post(`/accounting/periods/${id}/close`);
export const reopenPeriod = (id, body) => post(`/accounting/periods/${id}/reopen`, body);
export const getPostingRules = (signal) => apiRequest('/accounting/posting-rules', { signal });
export const listJournals = (p, signal) => apiRequest(`/accounting/journals${toQuery(p)}`, { signal });
export const getJournal = (id, signal) => apiRequest(`/accounting/journals/${id}`, { signal });
export const createJournal = (body) => post('/accounting/journals', body);
export const updateJournal = (id, body) => apiRequest(`/accounting/journals/${id}`, { method: 'PUT', body });
export const journalAction = (id, action, body) => post(`/accounting/journals/${id}/${action}`, body);
export const getLedger = (p, signal) => apiRequest(`/accounting/ledger${toQuery(p)}`, { signal });
export const getTrialBalance = (p, signal) => apiRequest(`/accounting/trial-balance${toQuery(p)}`, { signal });
export const getStatements = (p, signal) => apiRequest(`/accounting/statements${toQuery(p)}`, { signal });