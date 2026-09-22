'use client';
import { useActionState, startTransition, type FormEvent } from 'react';
import { uploadReportAction, type ActionState } from '@/server/research/actions';

const INITIAL: ActionState = { error: null };

/**
 * Paste or attach. Everything is validated server-side before a byte is parsed. Submitted through a transition rather
 * than as a form action, so a refused upload keeps the pasted report instead of wiping it (React resets a form
 * action's fields before it runs).
 */
export function UploadForm({ briefs }: { briefs: Array<{ id: string; promptId: string }> }) {
  const [state, dispatch, pending] = useActionState(uploadReportAction, INITIAL);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    startTransition(() => dispatch(data));
  };

  return (
    <form onSubmit={onSubmit} className="panel">
      {state.error ? (
        <div className="notice">
          <p><strong>{state.error}</strong></p>
          {state.details?.map(d => <p key={d} className="small">{d}</p>)}
        </div>
      ) : null}
      {state.ok ? (
        <div className="notice">
          <p><strong>{state.ok}</strong></p>
          {state.details?.slice(0, 12).map(d => <p key={d} className="small">{d}</p>)}
          <p className="small">Review the suggested companies on the <a href="/research">Research</a> page.</p>
        </div>
      ) : null}

      <div className="grid2">
        <label>
          Format
          <select name="format" defaultValue="markdown">
            <option value="markdown">Markdown</option>
            <option value="text">Plain text</option>
            <option value="json">JSON</option>
            <option value="csv">CSV</option>
          </select>
        </label>
        <label>
          Where did this come from?
          <select name="provider" defaultValue="GEMINI_DEEP_RESEARCH">
            <option value="GEMINI_DEEP_RESEARCH">Gemini Deep Research</option>
            <option value="CLAUDE_CODE">Claude Code</option>
            <option value="ANTIGRAVITY">Antigravity</option>
            <option value="HUMAN">A human wrote it</option>
            <option value="OTHER">Other</option>
          </select>
        </label>
        <label>
          Against which brief? <span className="muted">(optional)</span>
          <select name="briefId" defaultValue="">
            <option value="">No brief</option>
            {briefs.map(b => <option key={b.id} value={b.id}>{b.promptId}</option>)}
          </select>
        </label>
        <label>
          Filename <span className="muted">(optional — metadata only, never used as a path)</span>
          <input name="filename" placeholder="gemini-report-2026-09-16.md" />
        </label>
      </div>

      <label style={{ marginTop: 12 }}>
        Attach a file
        <input type="file" name="file" accept=".md,.markdown,.txt,.json,.csv,text/plain,text/markdown,application/json,text/csv" />
      </label>

      <label style={{ marginTop: 12 }}>
        …or paste the report
        <textarea name="content" placeholder={'## Company Name\n- Website: https://example.com\n- Country: United Kingdom\n- Archetype: 1\n- Decision maker: Jane Roe (source: https://example.com/team)\n- Commercial signal: Lists Nike as a client — https://example.com/clients\n- Friction: Portfolio fails on mobile\n  Source: https://example.com/work'} />
      </label>

      <div className="row" style={{ marginTop: 14 }}>
        <button type="submit" className="btn-act" disabled={pending}>{pending ? 'Reading…' : 'Upload'}</button>
        <span className="small muted">Nothing uploaded is ever run. The file is stored exactly as it is.</span>
      </div>
    </form>
  );
}
