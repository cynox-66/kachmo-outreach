import 'server-only';
import { requirePermission } from '../auth/current-actor';
import { getServer } from '../auth/instance';
import { recordAudit } from '../audit/audit';

export interface DispatchStatus {
  configured: boolean;
  repo: string;
  workflow: string;
}

export interface DispatchResult {
  ok: boolean;
  message: string;
  runUrl?: string;
  error?: string;
}

export async function checkDispatchConfiguration(): Promise<DispatchStatus> {
  const token = process.env.GITHUB_DISPATCH_TOKEN?.trim();
  const repo = process.env.GITHUB_REPOSITORY?.trim() || 'cynox-66/kachmo-outreach';
  const workflow = process.env.GITHUB_WORKFLOW_ID?.trim() || 'outreach-dispatch.yml';
  return {
    configured: Boolean(token),
    repo,
    workflow,
  };
}

export async function triggerOutreachDispatch(force = false): Promise<DispatchResult> {
  const actor = await requirePermission('outreach.email');
  const isOwnerOrAdmin = actor.roles.includes('OWNER') || actor.roles.includes('ADMIN');
  if (!isOwnerOrAdmin) {
    return {
      ok: false,
      error: 'DENIED',
      message: 'Only an owner or administrator can trigger automated outreach dispatch.',
    };
  }

  const token = process.env.GITHUB_DISPATCH_TOKEN?.trim();
  const repo = process.env.GITHUB_REPOSITORY?.trim() || 'cynox-66/kachmo-outreach';
  const workflow = process.env.GITHUB_WORKFLOW_ID?.trim() || 'outreach-dispatch.yml';
  const ref = process.env.GITHUB_REF?.trim() || 'main';

  if (!token) {
    return {
      ok: false,
      error: 'TOKEN_NOT_CONFIGURED',
      message: 'GITHUB_DISPATCH_TOKEN is not configured on this deployment. Add a GitHub Personal Access Token to your Vercel environment variables, or trigger the workflow directly from GitHub Actions.',
      runUrl: `https://github.com/${repo}/actions/workflows/${workflow}`,
    };
  }

  try {
    const url = `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'Kachmo-Outbound-OS',
      },
      body: JSON.stringify({
        ref,
        inputs: {
          force: force ? 'true' : 'false',
          dry_run: 'false',
        },
      }),
    });

    if (res.status === 204) {
      try {
        await recordAudit(getServer().db, {
          actor: { userId: actor.userId, label: actor.name || 'Owner' },
          action: 'outreach.dispatch_triggered',
          target: { type: 'workflow', id: workflow },
          metadata: { force, repo, ref },
        });
      } catch (auditErr) {
        console.warn('Audit record failed for dispatch trigger:', auditErr);
      }

      return {
        ok: true,
        message: `Dispatch workflow triggered on GitHub Actions (${force ? 'Force send' : 'Standard morning window check'}).`,
        runUrl: `https://github.com/${repo}/actions/workflows/${workflow}`,
      };
    }

    const errorText = await res.text();
    return {
      ok: false,
      error: 'GITHUB_ERROR',
      message: `GitHub API error (${res.status}): ${errorText || res.statusText}`,
      runUrl: `https://github.com/${repo}/actions/workflows/${workflow}`,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: 'NETWORK_ERROR',
      message: `Failed to connect to GitHub API: ${errorMsg}`,
      runUrl: `https://github.com/${repo}/actions/workflows/${workflow}`,
    };
  }
}
