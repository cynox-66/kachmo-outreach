'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getServer } from './instance';
import { recordAudit, hashIp } from '../audit/audit';

export interface SignInState {
  error?: string;
}

/**
 * Sign-in goes through Better Auth's HTTP handler rather than its direct API, so the same rate limiting, origin check
 * and cookie handling apply as for any other client. The message never reveals whether an email exists.
 */
export async function signInAction(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const { auth, db } = getServer();
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (!email || !password) return { error: 'Enter your email and password.' };

  const incoming = await headers();
  const baseURL = process.env.BETTER_AUTH_URL ?? '';
  const forwardedFor = incoming.get('x-forwarded-for') ?? '';
  const userAgent = incoming.get('user-agent');
  const response = await auth.handler(
    new Request(`${baseURL}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: incoming.get('origin') ?? new URL(baseURL).origin,
        ...(forwardedFor ? { 'x-forwarded-for': forwardedFor } : {}),
        ...(userAgent ? { 'user-agent': userAgent } : {}),
      },
      body: JSON.stringify({ email, password }),
    })
  );

  if (response.status === 429) return { error: 'Too many attempts. Wait a few minutes and try again.' };
  if (!response.ok) {
    await recordAudit(db, {
      actor: { userId: null, label: 'ANONYMOUS' },
      action: 'auth.sign_in_failed',
      target: { type: 'session' },
      ipHash: hashIp(forwardedFor.split(',')[0]?.trim() || null, process.env.BETTER_AUTH_SECRET ?? ''),
    });
    return { error: 'Invalid email or password.' };
  }

  const store = await cookies();
  for (const raw of response.headers.getSetCookie()) {
    const [pair, ...attrs] = raw.split(';');
    const eq = pair.indexOf('=');
    const name = pair.slice(0, eq).trim();
    const value = decodeURIComponent(pair.slice(eq + 1));
    const attr = (key: string) => attrs.find(a => a.trim().toLowerCase().startsWith(`${key}=`))?.split('=')[1]?.trim();
    const maxAge = attr('max-age');
    store.set({
      name,
      value,
      httpOnly: true,
      secure: attrs.some(a => a.trim().toLowerCase() === 'secure'),
      sameSite: (attr('samesite')?.toLowerCase() as 'lax' | 'strict' | 'none' | undefined) ?? 'lax',
      path: attr('path') ?? '/',
      ...(maxAge ? { maxAge: Number(maxAge) } : {}),
    });
  }
  redirect('/');
}

/** Ends the session server-side (and therefore in the database), then returns to the login page. */
export async function signOutAction(): Promise<void> {
  const { auth } = getServer();
  await auth.api.signOut({ headers: await headers() });
  const store = await cookies();
  for (const c of store.getAll()) if (c.name.includes('kachmo.session_token')) store.delete(c.name);
  redirect('/login');
}
