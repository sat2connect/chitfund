import { useCallback, useState } from 'react';

// Holds server-side list params (search/filter/page) and resets paging when filters change.
export function useListParams(initial = {}) {
  const [params, setParams] = useState({ page: 1, pageSize: 10, ...initial });
  const set = useCallback((patch) => setParams((p) => ({ ...p, page: 1, ...patch })), []);
  const setPage = useCallback((page) => setParams((p) => ({ ...p, page })), []);
  return { params, set, setPage };
}
