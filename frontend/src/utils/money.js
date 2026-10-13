// Rupee input handling. The API works in integer paise; conversion happens only at the UI edge.
export const RUPEE_PATTERN = /^\d+(\.\d{1,2})?$/;
export const parseRupees = (v) => {
  const t = String(v ?? '').trim().replace(/,/g, '');
  return RUPEE_PATTERN.test(t) ? Math.round(Number(t) * 100) : null;
};