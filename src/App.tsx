import { useMemo, useState } from 'react';
import { FIXTURES } from './lib/fixtures';
import { parseUsage, toCsv } from './lib/parse';
import { analyse, signalFamily, MIN_RECORDS, MIN_SPAN_DAYS } from './lib/verdict';
import { cluster2 } from './lib/cluster';
import type { UsageRecord, SignalResult } from './lib/types';
import { HourClock } from './components/HourClock';
import { ShapeScatter } from './components/ShapeScatter';

type Source = { label: string; note: string; records: UsageRecord[]; issues: number };

function fixtureSource(id: string): Source {
  const f = FIXTURES.find((x) => x.id === id)!;
  return { label: f.name, note: f.blurb, records: f.build(), issues: 0 };
}

export default function App() {
  const [source, setSource] = useState<Source>(() => fixtureSource('compromised'));
  const [active, setActive] = useState('compromised');
  const [paste, setPaste] = useState('');
  const [error, setError] = useState<string | null>(null);

  const verdict = useMemo(() => analyse(source.records), [source]);
  const labelled = useMemo(() => cluster2(source.records).labelled, [source]);

  function loadFixture(id: string) {
    setActive(id);
    setError(null);
    setSource(fixtureSource(id));
  }

  function ingest(text: string, label: string) {
    const { records, issues, mapping } = parseUsage(text);
    if (records.length === 0) {
      setError(issues[0]?.reason ?? 'No usable rows found.');
      return;
    }
    setError(null);
    setActive('yours');
    setSource({
      label,
      note: `Mapped ${mapping.timestamp} / ${mapping.model} / ${mapping.inputTokens} / ${mapping.outputTokens}`,
      records,
      issues: issues.length,
    });
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then((t) => ingest(t, file.name));
  }

  const separation = verdict.signals.filter((s) => signalFamily(s.id) === 'separation');
  const fingerprint = verdict.signals.filter((s) => signalFamily(s.id) === 'fingerprint');

  return (
    <div className="wrap">
      <header>
        <h1>Second Tenant</h1>
        <p className="sub">
          Stolen API keys are now the objective, not the side effect. If someone else is
          spending yours, the evidence is already in your usage export — two workloads with
          two different heartbeats, billed to one line item.
        </p>
        <p className="cite">
          Riding Anthropic&rsquo;s September 2026 threat report: “access to AI in the form of
          compromised API keys, session tokens, and devices has increasingly become the sole
          objective of multiple criminal groups.”
        </p>
      </header>

      <section className="controls">
        <div className="tabs">
          {FIXTURES.map((f) => (
            <button key={f.id} className={active === f.id ? 'on' : ''} onClick={() => loadFixture(f.id)}>
              {f.name}
            </button>
          ))}
          {active === 'yours' && <button className="on">{source.label}</button>}
        </div>
        <p className="note">{source.note}</p>

        <details className="own">
          <summary>Use your own export</summary>
          <p className="hint">
            CSV or JSON with a timestamp, token counts and (optionally) a model column. Column
            names from OpenAI, Azure OpenAI and Google exports are recognised automatically.
            Everything runs in this tab — nothing is uploaded.
          </p>
          <input type="file" accept=".csv,.json,.txt" onChange={onFile} />
          <textarea
            value={paste}
            placeholder={'timestamp,model,prompt_tokens,completion_tokens\n2026-08-24T09:15:00Z,gpt-4o-mini,812,344'}
            onChange={(e) => setPaste(e.target.value)}
          />
          <div className="row">
            <button className="primary" onClick={() => ingest(paste, 'Pasted export')} disabled={!paste.trim()}>
              Analyse
            </button>
            <button
              onClick={() => {
                const blob = new Blob([toCsv(source.records)], { type: 'text/csv' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `${active}-usage.csv`;
                a.click();
                URL.revokeObjectURL(a.href);
              }}
            >
              Download this dataset
            </button>
          </div>
          {error && <p className="err">{error}</p>}
        </details>
      </section>

      <section className={`verdict ${verdict.level}`}>
        <div className="vhead">
          <span className="badge">{verdict.headline}</span>
          {!verdict.insufficient && <span className="conf">{verdict.confidence}% confidence</span>}
        </div>
        {verdict.insufficient ? (
          <p>
            This export has {source.records.length} request(s). A judgement needs at least{' '}
            {MIN_RECORDS} requests spanning {MIN_SPAN_DAYS} days, otherwise a single busy
            afternoon looks like a second tenant.
          </p>
        ) : verdict.level === 'single' ? (
          <p>
            The traffic behaves as one workload. Splitting it in two produces groups that keep
            the same working hours, the same request shapes and the same models — which is what
            one team looks like.
          </p>
        ) : verdict.level === 'possible' ? (
          <p>
            There are two workloads here, and they keep different hours. But the second one
            sends <strong>your</strong> shape of request to <strong>your</strong> models — the
            fingerprint of a scheduled job you own, not of a stranger. Check your own cron before
            raising an incident.
          </p>
        ) : (
          <p>
            Two workloads, and the second does not look like you. It keeps different hours,
            sends a different shape of request, and reaches for models the first group never
            touches. That is the pattern of a key being used by someone else.
          </p>
        )}
      </section>

      {!verdict.insufficient && verdict.clusters.length === 2 && (
        <>
          <section className="panel">
            <h2>When each group works</h2>
            <HourClock clusters={verdict.clusters} />
            <div className="legend">
              <span><i className="sw g0" /> Group A — {verdict.clusters[0].count} requests</span>
              <span><i className="sw g1" /> Group B — {verdict.clusters[1].count} requests</span>
            </div>
          </section>

          <section className="grid2">
            <div className="panel">
              <h2>Rhythm — is there a second workload?</h2>
              {separation.map((s) => <Signal key={s.id} s={s} />)}
            </div>
            <div className="panel">
              <h2>Fingerprint — is it yours?</h2>
              {fingerprint.map((s) => <Signal key={s.id} s={s} />)}
              <ShapeScatter records={labelled} />
            </div>
          </section>

          <section className="panel">
            <h2>The two groups side by side</h2>
            <table className="cmp">
              <thead>
                <tr><th /><th>Group A</th><th>Group B</th></tr>
              </thead>
              <tbody>
                <tr><td>Requests</td>
                  {verdict.clusters.map((c) => <td key={c.id}>{c.count} ({(c.share * 100).toFixed(0)}%)</td>)}
                </tr>
                <tr><td>Busiest hour</td>
                  {verdict.clusters.map((c) => <td key={c.id}>{c.peakHour.toFixed(1)}h UTC</td>)}
                </tr>
                <tr><td>Median request</td>
                  {verdict.clusters.map((c) => <td key={c.id}>{c.medianInput} in / {c.medianOutput} out</td>)}
                </tr>
                <tr><td>Gap dispersion</td>
                  {verdict.clusters.map((c) => <td key={c.id}>{c.cadenceDispersion.toFixed(2)}</td>)}
                </tr>
                <tr><td>Weekend share</td>
                  {verdict.clusters.map((c) => <td key={c.id}>{(c.weekendShare * 100).toFixed(0)}%</td>)}
                </tr>
                <tr><td>Models</td>
                  {verdict.clusters.map((c) => (
                    <td key={c.id}>{c.topModels.map((m) => m.model).join(', ') || '—'}</td>
                  ))}
                </tr>
              </tbody>
            </table>
            <p className="note">
              Cluster separation {verdict.separation.toFixed(2)} — below about 0.45 the split is
              the algorithm guessing, and the rhythm evidence is discounted accordingly.
            </p>
          </section>
        </>
      )}

      <section className="panel limits">
        <h2>What this cannot tell you</h2>
        <ul>
          <li>
            <strong>It cannot prove a breach.</strong> It finds two behaviours billed to one
            key. A globally distributed team, a new CI pipeline, or a contractor onboarding all
            look the same from here.
          </li>
          <li>
            <strong>A patient attacker defeats it.</strong> Someone who mirrors your working
            hours, your prompt sizes and your model mix leaves no separation to find. This
            catches the common case — a scheduled job on a stolen key — not the careful one.
          </li>
          <li>
            <strong>Exactly two groups, always.</strong> The clusterer splits in two. Three
            tenants will be reported as two, with one of them blended.
          </li>
          <li>
            <strong>Timezone is inferred, not known.</strong> Hours are UTC as exported. A team
            that works 09:00 IST is not a second tenant just because your other team works in
            Seattle.
          </li>
        </ul>
        <p className="note">
          Verdicts here are deterministic: the same export always produces the same answer, with
          no model call and no network request. Treat the output as a lead for an investigation,
          not as its conclusion.
        </p>
      </section>

      <footer>
        <span>
          Day 033 of{' '}
          <a href="https://github.com/kbipul/kb-daily-builds">kb-daily-builds</a> ·{' '}
          <a href="https://github.com/kbipul/second-tenant">source</a>
        </span>
        <span>
          Built by <a href="https://www.kumarbipul.com">Kumar Bipul</a>
        </span>
      </footer>
    </div>
  );
}

function Signal({ s }: { s: SignalResult }) {
  const level = s.score >= 0.6 ? 'hi' : s.score >= 0.3 ? 'mid' : 'lo';
  return (
    <div className={`signal ${level}`}>
      <div className="sighead">
        <strong>{s.label}</strong>
        <span className="score">{s.score.toFixed(2)}</span>
      </div>
      <div className="meter"><i style={{ width: `${s.score * 100}%` }} /></div>
      <p>{s.finding}</p>
      <dl>
        {s.detail.map((d) => (
          <div key={d.k}><dt>{d.k}</dt><dd>{d.v}</dd></div>
        ))}
      </dl>
    </div>
  );
}
