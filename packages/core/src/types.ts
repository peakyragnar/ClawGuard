export type Severity = 'low' | 'medium' | 'high' | 'critical';

export type SkillFile = {
  path: string;
  content_text?: string;
  content_bytes_b64?: string;
  sha256?: string;
};

export type SkillBundle = {
  id: string;
  source?: 'local' | 'registry' | 'git' | 'unknown';
  version?: string;
  entrypoint: string;
  files: SkillFile[];
};

export type ScanFinding = {
  rule_id: string;
  severity: Severity;
  reason_code: string;
  file?: string;
  line?: number;
  column?: number;
  evidence: string;
};

export type ScanReport = {
  api_version: 1;
  risk_score: number;
  findings: ScanFinding[];
};

export type ToolCallContext = {
  tool_name: string;
  args: Record<string, unknown>;
  session_id?: string;
  run_id?: string;
  source?: string;
  timestamp?: string;
};

export type DecisionAction = 'allow' | 'deny' | 'needs_approval' | 'sandbox_only';

export type DecisionReason = {
  reason_code: string;
  detail?: string;
  evidence?: string;
};

export type Decision = {
  api_version: 1;
  action: DecisionAction;
  reasons: DecisionReason[];
  suggested_mitigations?: string[];
};

export type PolicyThresholds = {
  scan_deny_at?: number;
  scan_approve_at?: number;
};

export type Policy = {
  api_version: 1;
  tool?: {
    allowlist?: string[];
    denylist?: string[];
    elevated_requires_approval?: boolean;
    sandbox_only?: string[];
  };
  exec?: {
    allow_cmds?: string[];
    deny_cmds?: string[];
    deny_patterns?: string[];
  };
  paths?: {
    allow?: string[];
    deny?: string[];
  };
  urls?: {
    allow_domains?: string[];
    deny_domains?: string[];
    deny_schemes?: string[];
  };
  thresholds?: PolicyThresholds;
};
