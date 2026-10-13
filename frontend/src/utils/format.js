const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('en-IN');

export const formatINR = (v) => inr.format(v);
export const formatNumber = (v) => num.format(v);

// Money is stored/transferred as integer paise; these helpers convert at the UI edge only.
export const formatPaise = (p) =>
  p === undefined || p === null
    ? '\u2014'
    : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: p % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 }).format(p / 100);
export const rupeesToPaise = (v) => (v === '' || v === undefined || v === null ? undefined : Math.round(Number(v) * 100));
export const paiseToRupees = (p) => (p === undefined || p === null ? '' : String(p / 100));
