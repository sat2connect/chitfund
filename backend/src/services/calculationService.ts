import { badRequest, notFound } from '../errors/AppError.js';
import { Check } from '../validators/input.js';

/**
 * Calculation-engine INTERFACE (Phase 3/4).
 *
 * The financial formulas (dividend, commission, discount, prize amount) have NOT been supplied or approved, so this
 * service ships with NO rule sets registered and therefore cannot produce any figure. It defines how approved rule
 * sets will plug in later: versioned, validated against accountant-supplied test cases, and clearly separated from
 * sample data. Nothing here is used by collections, accounting or payouts.
 */

export const CALCULATION_KINDS = ['DIVIDEND', 'COMMISSION', 'DISCOUNT', 'PRIZE_AMOUNT'] as const;
export type CalculationKind = (typeof CALCULATION_KINDS)[number];

export interface CalculationInput {
  chitValuePaise: number;
  memberCount: number;
  installmentAmountPaise: number;
  /** Winning bid / discount offered in the auction cycle, in paise, when relevant. */
  bidAmountPaise?: number;
  cycleNo?: number;
}

export interface CalculationOutput {
  amountPaise: number;
  /** Human-readable working so a reviewer can follow the figure. */
  workings: string[];
}

export interface CalculationRuleSet {
  id: string;
  kind: CalculationKind;
  version: number;
  /** Only VALIDATED rule sets may be used for production figures; others give preview-only output. */
  status: 'DRAFT' | 'VALIDATED' | 'RETIRED';
  description: string;
  /** Reference of the approval (accountant / compliance) that validated this exact version. */
  approvalRef?: string;
  compute(input: CalculationInput): CalculationOutput;
}

export interface ValidationCase {
  name: string;
  input: CalculationInput;
  expectedAmountPaise: number;
}

/** Runs a rule set against accountant-supplied cases. Pure: no state is changed. */
export const validateRuleSet = (rs: CalculationRuleSet, cases: ValidationCase[]) => {
  const results = cases.map((tc) => {
    const actual = rs.compute(tc.input).amountPaise;
    return { name: tc.name, expectedAmountPaise: tc.expectedAmountPaise, actualAmountPaise: actual, passed: actual === tc.expectedAmountPaise };
  });
  return { ruleSetId: rs.id, version: rs.version, passed: results.length > 0 && results.every((r) => r.passed), results };
};

/** Shown whenever sample data is used. These are invented demonstration numbers, never scheme data. */
export const SAMPLE_INPUT: CalculationInput & { label: string } = {
  label: 'SAMPLE DATA, NOT A REAL SCHEME. For demonstrating the preview only.',
  chitValuePaise: 100_000_00,
  memberCount: 10,
  installmentAmountPaise: 10_000_00,
  bidAmountPaise: 10_000_00,
  cycleNo: 1,
};

export const createCalculationService = (ruleSets: CalculationRuleSet[] = []) => {
  const forKind = (kind: CalculationKind) => ruleSets.filter((r) => r.kind === kind).sort((a, b) => b.version - a.version);
  const describe = (r: CalculationRuleSet) => ({ id: r.id, kind: r.kind, version: r.version, status: r.status, description: r.description, approvalRef: r.approvalRef });

  return {
    rules() {
      return {
        notice:
          'No financial calculation rule has been approved. Dividend, commission, discount and prize-amount figures cannot be produced until an accountant-approved rule set is registered and validated.',
        kinds: CALCULATION_KINDS.map((kind) => ({
          kind,
          ruleSets: forKind(kind).map(describe),
          productionReady: forKind(kind).some((r) => r.status === 'VALIDATED' && !!r.approvalRef),
        })),
        sample: SAMPLE_INPUT,
      };
    },

    preview(body: Record<string, unknown>) {
      const c = new Check(body);
      const kind = c.oneOf('kind', CALCULATION_KINDS);
      c.done();
      let input: CalculationInput;
      let mode: 'SAMPLE' | 'USER_INPUT';
      if (body.useSample === true) {
        const { label: _label, ...rest } = SAMPLE_INPUT; // eslint-disable-line @typescript-eslint/no-unused-vars
        input = rest;
        mode = 'SAMPLE';
      } else {
        const ic = new Check((body.input ?? {}) as Record<string, unknown>);
        const chitValuePaise = ic.int('chitValuePaise', { required: true, min: 1 });
        const memberCount = ic.int('memberCount', { required: true, min: 2 });
        const installmentAmountPaise = ic.int('installmentAmountPaise', { required: true, min: 1 });
        const bidAmountPaise = ic.int('bidAmountPaise', { min: 0 });
        const cycleNo = ic.int('cycleNo', { min: 1 });
        if (Object.keys(ic.errors).length) throw badRequest('Validation failed', Object.fromEntries(Object.entries(ic.errors).map(([k, v]) => [`input.${k}`, v])));
        input = { chitValuePaise: chitValuePaise!, memberCount: memberCount!, installmentAmountPaise: installmentAmountPaise!, bidAmountPaise, cycleNo };
        mode = 'USER_INPUT';
      }
      const candidates = forKind(kind!);
      const chosen = candidates.find((r) => r.status === 'VALIDATED') ?? candidates.find((r) => r.status === 'DRAFT');
      const base = { kind, mode, input, sampleLabel: mode === 'SAMPLE' ? SAMPLE_INPUT.label : undefined };
      if (!chosen) {
        return {
          ...base, status: 'RULES_NOT_VALIDATED' as const, productionUse: false,
          notices: [`No approved rule is registered for ${kind}. No figure is produced.`],
        };
      }
      const out = chosen.compute(input);
      const validated = chosen.status === 'VALIDATED' && !!chosen.approvalRef;
      return {
        ...base, status: validated ? ('OK' as const) : ('PREVIEW_ONLY' as const), productionUse: false,
        ruleSet: describe(chosen), result: out,
        notices: [
          validated ? 'Figures from this endpoint are previews; production postings are not wired to the calculation engine.' : 'This rule set is not validated: the figure is for review only and must not be used for any real amount.',
          ...(mode === 'SAMPLE' ? [SAMPLE_INPUT.label] : []),
        ],
      };
    },

    validate(ruleSetId: string, cases: ValidationCase[]) {
      const rs = ruleSets.find((r) => r.id === ruleSetId);
      if (!rs) throw notFound('Rule set');
      return validateRuleSet(rs, cases);
    },
  };
};

export type CalculationService = ReturnType<typeof createCalculationService>;
