import type { Rule, RuleSelector } from './rules.js';
import type { ScanFinding } from './types.js';
import { indexToLineCol } from './utils.js';

export type ScanSignal = {
  type: RuleSelector;
  text: string;
  file?: string;
  offset?: number;
  baseLine?: number;
};

function buildRegex(rule: Rule): RegExp {
  const flags = rule.flags ?? 'gi';
  return new RegExp(rule.match, flags);
}

export function applyRules(signals: ScanSignal[], rules: Rule[]): ScanFinding[] {
  const findings: ScanFinding[] = [];
  for (const rule of rules) {
    for (const signal of signals) {
      if (!rule.selectors.includes(signal.type)) continue;
      const regex = buildRegex(rule);
      const matches = signal.text.matchAll(regex);
      for (const match of matches) {
        const index = match.index ?? 0;
        const evidence = match[0].slice(0, 220);
        const baseLine = signal.baseLine ?? 1;
        const location = indexToLineCol(signal.text, index);
        findings.push({
          rule_id: rule.id,
          severity: rule.severity,
          reason_code: rule.reason_code,
          file: signal.file,
          line: baseLine + location.line - 1,
          column: location.column,
          evidence,
        });
      }
    }
  }
  return findings;
}
