import { rolePermissions } from '../domain/rules.js';
import type { Permission, User } from '../domain/types.js';
import { forbidden } from '../errors/AppError.js';

export const permissionsOf = (u: User): Permission[] => [...new Set(u.roles.flatMap((r) => rolePermissions[r]))];
export const hasPermission = (u: User, p: Permission) => permissionsOf(u).includes(p);

export const canAccessBranch = (u: User, branchId: string) => u.branchIds === 'ALL' || u.branchIds.includes(branchId);

export const assertPermission = (u: User, p: Permission) => {
  if (!hasPermission(u, p)) throw forbidden(`Missing permission: ${p}`);
};

export const assertBranch = (u: User, branchId: string) => {
  if (!canAccessBranch(u, branchId)) throw forbidden('This record belongs to a branch you cannot access', 'FORBIDDEN_BRANCH');
};
