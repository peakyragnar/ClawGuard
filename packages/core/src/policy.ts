import type { Decision, DecisionAction, DecisionReason, Policy, ToolCallContext } from './types.js';
import { detectShellOperators, domainMatches, normalizeDomain, toArray, toCommandName } from './utils.js';

const DEFAULT_DENY_SCHEMES = ['file', 'data', 'javascript'];
const DEFAULT_DENY_DOMAINS = ['localhost', '127.0.0.1', '169.254.169.254'];
const DEFAULT_DENY_PATHS = [
  '.ssh',
  'id_rsa',
  'keychain',
  'Keychains',
  'Cookies',
  '.env',
  'AWS_SECRET_ACCESS_KEY',
  'GITHUB_TOKEN',
];

export function defaultPolicy(): Policy {
  return {
    api_version: 1,
    tool: {
      allowlist: [],
      denylist: [],
      elevated_requires_approval: true,
      sandbox_only: [],
    },
    exec: {
      allow_cmds: [],
      deny_cmds: [],
      deny_patterns: [],
    },
    paths: {
      deny: DEFAULT_DENY_PATHS,
    },
    urls: {
      deny_schemes: DEFAULT_DENY_SCHEMES,
      deny_domains: DEFAULT_DENY_DOMAINS,
    },
    thresholds: {
      scan_deny_at: 80,
      scan_approve_at: 40,
    },
  };
}

function buildDecision(action: DecisionAction, reasons: DecisionReason[], mitigations?: string[]): Decision {
  return {
    api_version: 1,
    action,
    reasons,
    ...(mitigations ? { suggested_mitigations: mitigations } : {}),
  };
}

function deny(reason_code: string, detail?: string, evidence?: string): Decision {
  return buildDecision('deny', [{ reason_code, detail, evidence }]);
}

function needsApproval(reason_code: string, detail?: string, evidence?: string): Decision {
  return buildDecision('needs_approval', [{ reason_code, detail, evidence }]);
}

function toolMatchesPattern(toolName: string, pattern: string): boolean {
  if (!pattern) return false;
  if (pattern.endsWith('*')) return toolName.startsWith(pattern.slice(0, -1));
  return toolName === pattern;
}

export function evaluateToolCall(call: ToolCallContext, policy: Policy): Decision {
  const toolName = call.tool_name;
  const toolPolicy = policy.tool ?? {};
  const allowlist = toArray(toolPolicy.allowlist);
  const denylist = toArray(toolPolicy.denylist);

  if (denylist.includes(toolName)) {
    return deny('tool_denylist', toolName);
  }
  if (allowlist.length > 0 && !allowlist.includes(toolName)) {
    return deny('tool_not_allowlisted', toolName);
  }

  if (toolName === 'system_exec') {
    const cmd = String(call.args.cmd ?? '');
    const cmdName = toCommandName(cmd);
    const allowCmds = toArray(policy.exec?.allow_cmds);
    const denyCmds = toArray(policy.exec?.deny_cmds);
    if (denyCmds.includes(cmdName)) {
      return deny('exec_cmd_denylist', cmdName);
    }
    if (allowCmds.length > 0 && !allowCmds.includes(cmdName)) {
      return deny('exec_cmd_not_allowlisted', cmdName);
    }
    const allArgs = [cmd, ...(Array.isArray(call.args.args) ? call.args.args.map(String) : [])].join(' ');
    const denyPatterns = toArray(policy.exec?.deny_patterns);
    for (const raw of denyPatterns) {
      if (!raw) continue;
      try {
        const re = new RegExp(String(raw), 'i');
        if (re.test(allArgs)) return deny('exec_pattern_denied', String(raw), allArgs.slice(0, 180));
      } catch {
        // ignore invalid patterns
      }
    }
    if (detectShellOperators(allArgs)) {
      return deny('exec_shell_operators', allArgs.slice(0, 180));
    }
  }

  if (toolName === 'system_read_file' || toolName === 'system_write_file') {
    const path = String(call.args.path ?? '');
    const denyPaths = toArray(policy.paths?.deny ?? DEFAULT_DENY_PATHS);
    for (const entry of denyPaths) {
      if (entry && path.includes(entry)) {
        return deny('path_denied', entry, path);
      }
    }
  }

  if (toolName.startsWith('browser_') || toolName === 'system_exec') {
    const url = String(call.args.url ?? '');
    if (url) {
      try {
        const parsed = new URL(url);
        const scheme = parsed.protocol.replace(':', '');
        const denySchemes = toArray(policy.urls?.deny_schemes ?? DEFAULT_DENY_SCHEMES);
        if (denySchemes.includes(scheme)) {
          return deny('url_scheme_denied', scheme, url);
        }
        const domain = normalizeDomain(parsed.hostname);
        const denyDomains = toArray(policy.urls?.deny_domains ?? DEFAULT_DENY_DOMAINS);
        for (const entry of denyDomains) {
          if (domainMatches(domain, normalizeDomain(entry))) {
            return deny('url_domain_denied', entry, url);
          }
        }
        const allowDomains = toArray(policy.urls?.allow_domains);
        if (allowDomains.length > 0 && !allowDomains.some((entry) => domainMatches(domain, normalizeDomain(entry)))) {
          return deny('url_domain_not_allowlisted', domain, url);
        }
      } catch {
        return deny('url_invalid', '', url);
      }
    }
  }

  const sandboxOnly = toArray(toolPolicy.sandbox_only);
  if (sandboxOnly.some((entry) => toolMatchesPattern(toolName, String(entry)))) {
    return buildDecision(
      'sandbox_only',
      [{ reason_code: 'sandbox_only', detail: toolName }],
      ['Run in an isolated sandbox', 'Disable network egress by default', 'Mount workspace read-only', 'Keep approvals enabled for elevated tools'],
    );
  }

  const isElevated =
    toolName.startsWith('system_') || toolName.startsWith('browser_') || toolName === 'workflow_tool';
  if (isElevated && toolPolicy.elevated_requires_approval) {
    return needsApproval('elevated_requires_approval', toolName);
  }

  return buildDecision('allow', []);
}
