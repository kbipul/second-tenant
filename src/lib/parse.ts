import type { ParseIssue, ParseResult, UsageRecord } from './types';

/**
 * Column aliases. Providers all export the same four facts under different
 * names; this maps the common ones rather than forcing a fixed schema.
 */
const ALIASES: Record<keyof Omit<UsageRecord, never>, string[]> = {
  ts: ['timestamp', 'ts', 'time', 'created_at', 'createdat', 'date', 'datetime', 'start_time'],
  model: ['model', 'deployment', 'deployment_name', 'model_name', 'engine'],
  inputTokens: [
    'input_tokens', 'inputtokens', 'prompt_tokens', 'prompttokens',
    'input', 'tokens_in', 'promptTokenCount',
  ],
  outputTokens: [
    'output_tokens', 'outputtokens', 'completion_tokens', 'completiontokens',
    'output', 'tokens_out', 'candidatesTokenCount',
  ],
};

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function findColumn(headers: string[], key: keyof typeof ALIASES): number {
  const wanted = ALIASES[key].map(norm);
  for (let i = 0; i < headers.length; i++) {
    if (wanted.includes(norm(headers[i]))) return i;
  }
  return -1;
}

function parseTimestamp(raw: string): number | null {
  const s = raw.trim().replace(/^"|"$/g, '');
  if (s === '') return null;
  // Bare epoch seconds or milliseconds.
  if (/^\d{10}$/.test(s)) return Number(s) * 1000;
  if (/^\d{13}$/.test(s)) return Number(s);
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

/** Accepts CSV with a header row, or a JSON array of objects. */
export function parseUsage(text: string): ParseResult {
  const trimmed = text.trim();
  if (trimmed.startsWith('[')) return parseJson(trimmed);
  return parseCsv(trimmed);
}

function parseJson(text: string): ParseResult {
  const issues: ParseIssue[] = [];
  let rows: unknown;
  try {
    rows = JSON.parse(text);
  } catch {
    return { records: [], issues: [{ line: 1, reason: 'Not valid JSON' }], mapping: {} };
  }
  if (!Array.isArray(rows)) {
    return { records: [], issues: [{ line: 1, reason: 'Expected a JSON array' }], mapping: {} };
  }
  const keys = rows.length > 0 && rows[0] && typeof rows[0] === 'object'
    ? Object.keys(rows[0] as object)
    : [];
  const asCsv = [
    keys.join(','),
    ...rows.map((r) =>
      keys
        .map((k) => {
          const v = String((r as Record<string, unknown>)[k] ?? '');
          return v.includes(',') ? `"${v.replace(/"/g, '""')}"` : v;
        })
        .join(','),
    ),
  ].join('\n');
  const res = parseCsv(asCsv);
  return { ...res, issues: [...issues, ...res.issues] };
}

function parseCsv(text: string): ParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) {
    return {
      records: [],
      issues: [{ line: 1, reason: 'Need a header row plus at least one data row' }],
      mapping: {},
    };
  }
  const headers = splitCsvLine(lines[0]);
  const iTs = findColumn(headers, 'ts');
  const iModel = findColumn(headers, 'model');
  const iIn = findColumn(headers, 'inputTokens');
  const iOut = findColumn(headers, 'outputTokens');

  const missing: string[] = [];
  if (iTs < 0) missing.push('timestamp');
  if (iIn < 0) missing.push('input tokens');
  if (iOut < 0) missing.push('output tokens');
  if (missing.length > 0) {
    return {
      records: [],
      issues: [{ line: 1, reason: `Could not find column(s): ${missing.join(', ')}` }],
      mapping: {},
    };
  }

  const mapping: Record<string, string> = {
    timestamp: headers[iTs],
    model: iModel >= 0 ? headers[iModel] : '(none — treated as one model)',
    inputTokens: headers[iIn],
    outputTokens: headers[iOut],
  };

  const records: UsageRecord[] = [];
  const issues: ParseIssue[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const ts = parseTimestamp(cells[iTs] ?? '');
    if (ts === null) {
      if (issues.length < 12) issues.push({ line: i + 1, reason: 'Unreadable timestamp' });
      continue;
    }
    const inTok = Number(String(cells[iIn] ?? '').trim());
    const outTok = Number(String(cells[iOut] ?? '').trim());
    if (!Number.isFinite(inTok) || !Number.isFinite(outTok)) {
      if (issues.length < 12) issues.push({ line: i + 1, reason: 'Non-numeric token count' });
      continue;
    }
    records.push({
      ts,
      model: iModel >= 0 ? (cells[iModel] ?? '').trim() || 'unknown' : 'unknown',
      inputTokens: Math.max(0, Math.round(inTok)),
      outputTokens: Math.max(0, Math.round(outTok)),
    });
  }
  records.sort((a, b) => a.ts - b.ts);
  return { records, issues, mapping };
}

export function toCsv(records: UsageRecord[]): string {
  const head = 'timestamp,model,input_tokens,output_tokens';
  const body = records
    .map((r) =>
      [new Date(r.ts).toISOString(), r.model, r.inputTokens, r.outputTokens].join(','),
    )
    .join('\n');
  return `${head}\n${body}`;
}
