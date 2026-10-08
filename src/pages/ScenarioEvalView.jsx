import React, { useCallback, useRef, useState } from 'react';
import { LocalModelClient } from '../protocols/LocalModelClient';
import { DEFAULT_LOCAL_SYSTEM_PROMPT } from '../utils/galaxyPlanning';
import { SCENARIOS, runScenarioBattery, classForScenario } from '../utils/scenarioEval';

const menuBtn = {
  background: '#1c1c28',
  border: '1px solid #2c2c38',
  borderRadius: 10,
  width: 36,
  height: 36,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#888',
  cursor: 'pointer',
  fontSize: 16,
};

const btnStyle = {
  background: '#22d3ee',
  color: '#05060a',
  border: 'none',
  borderRadius: 8,
  padding: '6px 14px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};

const ghostBtnStyle = {
  background: '#1c1c28',
  border: '1px solid #2c2c38',
  borderRadius: 8,
  padding: '6px 12px',
  fontSize: 12,
  color: '#a0a0b8',
  cursor: 'pointer',
};

const cardStyle = {
  background: '#15151f',
  border: '1px solid #22222e',
  borderRadius: 12,
};

const thStyle = {
  padding: '8px 12px',
  fontSize: 11,
  fontWeight: 600,
  color: '#666679',
  textAlign: 'left',
  borderBottom: '1px solid #22222e',
  whiteSpace: 'nowrap',
};

const tdStyle = {
  padding: '8px 12px',
  fontSize: 13,
  color: '#e0e0ea',
  verticalAlign: 'top',
  borderBottom: '1px solid #1b1b26',
};

const errorBoxStyle = {
  border: '1px solid #ef4444',
  borderRadius: 8,
  padding: 12,
  fontSize: 13,
  color: '#f87171',
  background: 'rgba(239,68,68,0.08)',
  marginBottom: 12,
};

/**
 * Scenario eval — runs the REAL on-device chat + tool path through a battery of
 * Open-Chat scenarios for the currently selected model. Use it to compare
 * Qwen3.5-4B / Qwen3.5-0.8B / Gemma 4 E2B on the phone: select a model, tap
 * Run, and read the per-scenario pass/fail + latency table.
 */
export function ScenarioEvalView({ model = 'auto', onOpenMenu = null }) {
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState(null);
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState('');
  const [output, setOutput] = useState('');

  const clientRef = useRef(null);
  const currentToolCalls = useRef([]);

  const buildClient = useCallback((m) => {
    const bot = {
      model: m,
      systemPrompt: DEFAULT_LOCAL_SYSTEM_PROMPT,
      phoneToolsEnabled: true,
      galaxySkillsEnabled: false,
      autoResearchEnabled: true,
      cloudToolsEnabled: true,
      recipesEnabled: false,
    };
    const client = new LocalModelClient(bot, {
      confirmAction: async () => true, // let web_search / phone tools proceed
      onToolCall: (call) => {
        if (call && call.name) currentToolCalls.current.push({ name: call.name, args: call.args || {} });
      },
    });
    clientRef.current = client;
    return client;
  }, []);

  const run = useCallback(async () => {
    setRunning(true);
    setReport(null);
    setOutput('');
    setStatus('loading');
    const client = buildClient(model);
    const started = Date.now();
    try {
      // Connect (auto-loads the model if a bundle exists).
      const st = await client.connect();
      if (st === 'no-model') {
        setStatus('no-model');
        setOutput('No on-device model loaded — download one on the Models screen first.');
        return;
      }
      setStatus('connected');

      const battery = await runScenarioBattery({
        onScenario: (row) => setProgress(`${row.id}: ${row.ok ? '✓' : '✗'} (${row.latencyMs}ms)`),
        send: async (prompt, onChunk) => {
          currentToolCalls.current = [];
          let text = '';
          const prior = [];
          const reply = await client.send(prompt, (delta) => { text += delta; onChunk?.(delta); }, undefined, prior);
          return { reply: typeof reply === 'string' && reply ? reply : text, toolCalls: currentToolCalls.current };
        },
      });
      setReport({ ...battery, model, durationMs: Date.now() - started });
      setStatus('done');
    } catch (e) {
      setStatus('error');
      setOutput(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
      clientRef.current?.disconnect();
      clientRef.current = null;
    }
  }, [model, buildClient]);

  const downloadCsv = useCallback(() => {
    if (!report) return;
    const rows = [
      ['scenario', 'class', 'ok', 'score', 'latency_ms', 'reply'],
      ...report.results.map((r) => [r.id, classForScenario(SCENARIOS.find((s) => s.id === r.id)), r.ok ? '1' : '0', r.score, r.latencyMs, r.reply.replace(/\n/g, ' ')]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `open-chat-eval-${report.model}.csv`;
    a.click();
  }, [report]);

  const passRate = report ? Math.round((report.ok / report.total) * 100) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#111118' }}>
      <div style={{ padding: '52px 20px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {onOpenMenu && (
            <button onClick={onOpenMenu} aria-label="Open navigation menu" style={menuBtn}>
              ☰
            </button>
          )}
          <h1
            style={{
              fontSize: 28,
              fontWeight: 700,
              color: '#f0f0f5',
              letterSpacing: '-0.02em',
              margin: 0,
            }}
          >
            Model Eval
          </h1>
        </div>
        <p style={{ color: '#666679', fontSize: 13, margin: '8px 0 0 0', lineHeight: 1.5 }}>
          Runs the real chat + tool loop through {SCENARIOS.length} Open-Chat scenarios for model{' '}
          <span style={{ fontFamily: 'monospace' }}>{model}</span>. Switch the model in Settings and re-run to compare.
        </p>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 20px 32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          <button onClick={run} disabled={running} style={{ ...btnStyle, opacity: running ? 0.5 : 1 }}>
            {running ? 'Running…' : 'Run battery'}
          </button>
          {report && (
            <button onClick={downloadCsv} style={ghostBtnStyle}>
              Download CSV
            </button>
          )}
          {report && (
            <span style={{ fontSize: 12, color: '#8a8a9e' }}>
              Pass {report.ok}/{report.total} ({passRate}%) · avg {report.latencyMs}ms · {report.durationMs}ms wall
            </span>
          )}
        </div>

        {status === 'no-model' && <div style={errorBoxStyle}>{output}</div>}
        {status === 'error' && <div style={errorBoxStyle}>{output}</div>}
        {progress && (
          <pre style={{ margin: '0 0 12px', whiteSpace: 'pre-wrap', fontSize: 11, color: '#666679' }}>{progress}</pre>
        )}

        {report && (
          <div style={{ ...cardStyle, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={thStyle}>Scenario</th>
                  <th style={thStyle}>Class</th>
                  <th style={thStyle}>Result</th>
                  <th style={thStyle}>Score</th>
                  <th style={thStyle}>Latency</th>
                  <th style={thStyle}>Tool calls</th>
                  <th style={thStyle}>Reply</th>
                </tr>
              </thead>
              <tbody>
                {report.results.map((r) => (
                  <tr key={r.id}>
                    <td style={tdStyle}>{r.label}</td>
                    <td style={{ ...tdStyle, color: '#666679' }}>
                      {classForScenario(SCENARIOS.find((s) => s.id === r.id))}
                    </td>
                    <td style={tdStyle}>
                      <span
                        style={{
                          borderRadius: 4,
                          padding: '2px 6px',
                          fontSize: 11,
                          fontWeight: 600,
                          background: r.ok ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                          color: r.ok ? '#4ade80' : '#f87171',
                        }}
                      >
                        {r.ok ? 'PASS' : 'FAIL'}
                      </span>
                      {!r.ok && r.issues.length > 0 && (
                        <div style={{ marginTop: 4, fontSize: 11, color: '#f87171' }}>{r.issues.join('; ')}</div>
                      )}
                    </td>
                    <td style={tdStyle}>{r.score}</td>
                    <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 11 }}>{r.latencyMs}ms</td>
                    <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 11 }}>
                      {r.toolCalls.length > 0 ? r.toolCalls.map((t) => t.name).join(', ') : '—'}
                    </td>
                    <td
                      style={{
                        ...tdStyle,
                        maxWidth: 280,
                        fontSize: 12,
                        color: '#8a8a9e',
                        display: '-webkit-box',
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {r.reply ? r.reply : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
