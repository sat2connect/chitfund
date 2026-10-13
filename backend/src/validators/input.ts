import { badRequest } from '../errors/AppError.js';

type Body = Record<string, unknown>;

/** Small hand-rolled validator (no extra dependency). Collects all field errors. */
export class Check {
  errors: Record<string, string> = {};
  constructor(private body: Body) {}

  str(field: string, o: { required?: boolean; min?: number; max?: number; pattern?: RegExp; msg?: string } = {}) {
    const raw = this.body[field];
    const v = typeof raw === 'string' ? raw.trim() : raw;
    if (v === undefined || v === null || v === '') {
      if (o.required) this.errors[field] = 'Required';
      return undefined;
    }
    if (typeof v !== 'string') { this.errors[field] = 'Must be text'; return undefined; }
    if (o.min && v.length < o.min) this.errors[field] = `Must be at least ${o.min} characters`;
    else if (o.max && v.length > o.max) this.errors[field] = `Must be at most ${o.max} characters`;
    else if (o.pattern && !o.pattern.test(v)) this.errors[field] = o.msg ?? 'Invalid format';
    return v;
  }

  oneOf<T extends string>(field: string, allowed: readonly T[], required = true): T | undefined {
    const v = this.str(field, { required });
    if (v !== undefined && !allowed.includes(v as T)) {
      this.errors[field] = `Must be one of: ${allowed.join(', ')}`;
      return undefined;
    }
    return v as T | undefined;
  }

  int(field: string, o: { required?: boolean; min?: number; max?: number } = {}) {
    const v = this.body[field];
    if (v === undefined || v === null || v === '') {
      if (o.required) this.errors[field] = 'Required';
      return undefined;
    }
    if (typeof v !== 'number' || !Number.isInteger(v)) { this.errors[field] = 'Must be a whole number'; return undefined; }
    if (o.min !== undefined && v < o.min) this.errors[field] = `Must be at least ${o.min}`;
    else if (o.max !== undefined && v > o.max) this.errors[field] = `Must be at most ${o.max}`;
    return v;
  }

  list(field: string, o: { max?: number; itemMax?: number } = {}) {
    const v = this.body[field];
    if (v === undefined || v === null) return [] as string[];
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !x.trim())) {
      this.errors[field] = 'Must be a list of non-empty text items';
      return [] as string[];
    }
    const items = v.map((x: string) => x.trim());
    if (o.max && items.length > o.max) this.errors[field] = `At most ${o.max} items`;
    if (o.itemMax && items.some((x) => x.length > o.itemMax!)) this.errors[field] = `Each item at most ${o.itemMax} characters`;
    return items;
  }

  date(field: string, required = false) {
    const v = this.str(field, { required });
    if (v !== undefined && Number.isNaN(Date.parse(v))) this.errors[field] = 'Invalid date';
    return v;
  }

  done() {
    if (Object.keys(this.errors).length) throw badRequest('Validation failed', this.errors);
  }
}

export const PHONE = /^[6-9]\d{9}$/;
export const PHONE_MSG = 'Enter a 10-digit Indian mobile number';
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
