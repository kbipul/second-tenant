import { describe, it, expect } from 'vitest';
import { parseUsage, toCsv } from '../parse';

describe('parseUsage - CSV', () => {
  it('reads a standard OpenAI-style export', () => {
    const csv = [
      'timestamp,model,prompt_tokens,completion_tokens',
      '2026-08-24T09:15:00Z,gpt-4o-mini,800,300',
      '2026-08-24T09:17:00Z,gpt-4o,1200,450',
    ].join('\n');
    const { records, issues, mapping } = parseUsage(csv);
    expect(issues).toHaveLength(0);
    expect(records).toHaveLength(2);
    expect(records[0].model).toBe('gpt-4o-mini');
    expect(records[0].inputTokens).toBe(800);
    expect(records[1].outputTokens).toBe(450);
    expect(mapping.inputTokens).toBe('prompt_tokens');
  });

  it('accepts Azure-style deployment column names', () => {
    const csv = [
      'created_at,deployment_name,input_tokens,output_tokens',
      '2026-08-24T09:15:00Z,prod-gpt4o,10,20',
    ].join('\n');
    const { records, mapping } = parseUsage(csv);
    expect(records).toHaveLength(1);
    expect(mapping.model).toBe('deployment_name');
  });

  it('accepts epoch seconds and milliseconds', () => {
    const csv = [
      'ts,model,input,output',
      '1787000000,a,1,2',
      '1787000000000,b,3,4',
    ].join('\n');
    const { records } = parseUsage(csv);
    expect(records).toHaveLength(2);
    expect(records[0].ts).toBe(records[1].ts);
  });

  it('sorts records chronologically', () => {
    const csv = [
      'ts,model,input,output',
      '2026-08-25T00:00:00Z,a,1,1',
      '2026-08-24T00:00:00Z,b,1,1',
    ].join('\n');
    const { records } = parseUsage(csv);
    expect(records[0].model).toBe('b');
  });

  it('reports unreadable rows without discarding the good ones', () => {
    const csv = [
      'ts,model,input,output',
      '2026-08-24T09:15:00Z,a,100,50',
      'not-a-date,b,100,50',
      '2026-08-24T10:15:00Z,c,oops,50',
    ].join('\n');
    const { records, issues } = parseUsage(csv);
    expect(records).toHaveLength(1);
    expect(issues).toHaveLength(2);
    expect(issues[0].reason).toMatch(/timestamp/i);
    expect(issues[1].reason).toMatch(/numeric/i);
  });

  it('handles quoted fields containing commas', () => {
    const csv = ['ts,model,input,output', '2026-08-24T09:15:00Z,"a,b",5,6'].join('\n');
    const { records } = parseUsage(csv);
    expect(records[0].model).toBe('a,b');
  });

  it('explains which column is missing', () => {
    const csv = ['ts,model,input', '2026-08-24T09:15:00Z,a,5'].join('\n');
    const { records, issues } = parseUsage(csv);
    expect(records).toHaveLength(0);
    expect(issues[0].reason).toMatch(/output tokens/);
  });

  it('works without a model column', () => {
    const csv = ['ts,input,output', '2026-08-24T09:15:00Z,5,6'].join('\n');
    const { records, issues } = parseUsage(csv);
    expect(issues).toHaveLength(0);
    expect(records[0].model).toBe('unknown');
  });
});

describe('parseUsage - JSON', () => {
  it('reads an array of objects', () => {
    const json = JSON.stringify([
      { timestamp: '2026-08-24T09:15:00Z', model: 'gpt-4o', input_tokens: 10, output_tokens: 20 },
    ]);
    const { records, issues } = parseUsage(json);
    expect(issues).toHaveLength(0);
    expect(records[0].inputTokens).toBe(10);
  });

  it('rejects malformed JSON with a clear message', () => {
    const { records, issues } = parseUsage('[{');
    expect(records).toHaveLength(0);
    expect(issues[0].reason).toMatch(/JSON/);
  });
});

describe('toCsv', () => {
  it('round-trips through the parser', () => {
    const original = [
      { ts: Date.UTC(2026, 7, 24, 9, 0, 0), model: 'gpt-4o', inputTokens: 11, outputTokens: 22 },
    ];
    const { records } = parseUsage(toCsv(original));
    expect(records).toEqual(original);
  });
});
