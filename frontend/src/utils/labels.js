export const humanize = (s) => (s ? s.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : '—');

const tones = {
  NEW: 'neutral', CONTACTED: 'info', INTERESTED: 'info', REGISTRATION_PENDING: 'warning', CONVERTED: 'success', LOST: 'danger',
  NOT_STARTED: 'neutral', DOCUMENTS_PENDING: 'warning', UNDER_REVIEW: 'info', CORRECTION_REQUIRED: 'warning', VERIFIED: 'success', REJECTED: 'danger',
  SUBMITTED: 'info', APPROVED: 'success', OPEN: 'info', DONE: 'success',
  DRAFT: 'neutral', PUBLISHED: 'success', RETIRED: 'neutral', PENDING: 'warning', IN_REVIEW: 'info', RETURNED: 'warning', CANCELLED: 'neutral',
  APPROVAL_PENDING: 'warning', ENROLMENT_OPEN: 'info', READY_TO_START: 'info', SUSPENDED: 'danger', COMPLETED: 'success', CLOSED: 'neutral',
  NONE: 'neutral', ENROLMENT_PENDING: 'warning', ACTIVE: 'success', ACTIVE_MEMBER: 'success', KYC_UNDER_REVIEW: 'info',
};
export const toneOf = (s) => tones[s] ?? 'neutral';

export const formatDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const formatDateTime = (iso) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
