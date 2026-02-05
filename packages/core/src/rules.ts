import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Severity } from './types.js';

export type RuleSelector = 'markdown' | 'codeblock' | 'url' | 'path' | 'file';

export type Rule = {
  id: string;
  title: string;
  severity: Severity;
  reason_code: string;
  selectors: RuleSelector[];
  match: string;
  flags?: string;
  score: number;
};

export type RulePack = {
  pack_id: string;
  pack_version: string;
  rules: Rule[];
};

function rulesPath(): string {
  const current = fileURLToPath(import.meta.url);
  return join(dirname(current), '..', 'rules', 'pack-v1.json');
}

export function loadDefaultRulePack(): RulePack {
  const raw = readFileSync(rulesPath(), 'utf8');
  return JSON.parse(raw) as RulePack;
}
