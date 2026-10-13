import { apiRequest, toQuery } from '../../services/apiClient.js';

const post = (path, body) => apiRequest(path, { method: 'POST', body });

export const getAuctionMeta = (signal) => apiRequest('/auctions/meta', { signal });
export const listAuctions = (p, signal) => apiRequest(`/auctions${toQuery(p)}`, { signal });
export const getAuction = (id, signal) => apiRequest(`/auctions/${id}`, { signal });
export const createAuction = (body) => post('/auctions', body);
export const auctionAction = (id, action, body) => post(`/auctions/${id}/${action}`, body);
export const submitBid = (id, body) => post(`/auctions/${id}/bids`, body);
export const resolveDispute = (id, disputeId, body) => post(`/auctions/${id}/disputes/${disputeId}/resolve`, body);

export const getPayoutMeta = (signal) => apiRequest('/payouts/meta', { signal });
export const listPayouts = (p, signal) => apiRequest(`/payouts${toQuery(p)}`, { signal });
export const getPayout = (id, signal) => apiRequest(`/payouts/${id}`, { signal });
export const createPayout = (body) => post('/payouts', body);
export const updatePayout = (id, body) => apiRequest(`/payouts/${id}`, { method: 'PUT', body });
export const payoutAction = (id, action, body) => post(`/payouts/${id}/${action}`, body);
export const getPayoutReconQueue = (p, signal) => apiRequest(`/payouts/reconciliation${toQuery(p)}`, { signal });
export const matchPayout = (body) => post('/payouts/reconciliation/match', body);