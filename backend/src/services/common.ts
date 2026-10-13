import type { Activity, User } from '../domain/types.js';
import type { Store } from '../repositories/store.js';
import { canAccessBranch } from '../policies/access.js';


export const audit = (s: Store, actor: User, action: string, entityType: string, entityId: string, detail?: unknown) => {
  s.audit.push({ id: s.nextId('AUD'), at: s.now().toISOString(), actorId: actor.id, action, entityType, entityId, detail });
};

export const logActivity = (
  s: Store, actor: User, entityType: Activity['entityType'], entityId: string, type: string, note: string,
) => {
  s.activities.push({ id: s.nextId('ACT'), entityType, entityId, type, note, actorId: actor.id, at: s.now().toISOString() });
};

export interface PageQuery { page?: unknown; pageSize?: unknown }

export const paginate = <T>(items: T[], q: PageQuery) => {
  const pageSize = Math.min(Math.max(Number(q.pageSize) || 10, 1), 100);
  const page = Math.max(Number(q.page) || 1, 1);
  return { items: items.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: items.length };
};

export const inScope = <T extends { branchId: string }>(s: User, rows: T[]) => rows.filter((r) => canAccessBranch(s, r.branchId));

export const matches = (q: unknown, ...fields: (string | undefined)[]) => {
  if (typeof q !== 'string' || !q.trim()) return true;
  const needle = q.trim().toLowerCase();
  return fields.some((f) => f?.toLowerCase().includes(needle));
};

export const userName = (s: Store, id?: string) => s.users.find((u) => u.id === id)?.name ?? id;

import { conflict } from '../errors/AppError.js';
import type { StatusEvent } from '../domain/types.js';
import type { Store as StoreT } from '../repositories/store.js';

/** Applies a status change only if the transition table allows it, and records it in the history. */
export const changeStatus = <T extends { status: string; history: StatusEvent[] }>(
  s: StoreT, actor: User, entity: T, to: T['status'], table: Record<string, string[]>, comment?: string,
) => {
  if (!table[entity.status]?.includes(to)) {
    throw conflict('INVALID_TRANSITION', `Cannot move from ${entity.status} to ${to}`);
  }
  entity.history.push({ id: s.nextId('EV'), at: s.now().toISOString(), actorId: actor.id, from: entity.status, to, comment });
  entity.status = to;
};
