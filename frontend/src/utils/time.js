// Times are shown in the viewer's locale; the server clock is the only authority for bidding windows.
export const formatTime = (iso) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-';
// <input type="datetime-local"> value (local time) -> ISO string
export const localToIso = (v) => (v ? new Date(v).toISOString() : undefined);