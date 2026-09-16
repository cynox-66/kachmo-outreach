'use client';

import { useActionState } from 'react';
import { signInAction, type SignInState } from '@/server/auth/actions';

/** The form only collects input and shows the server's message; it makes no authorization decision. */
export function LoginForm() {
  const [state, action, pending] = useActionState<SignInState, FormData>(signInAction, {});
  return (
    <form action={action}>
      <div className="brand">
        Kachmo Outbound OS
        <small>Private internal system</small>
      </div>
      <label>
        Email
        <input name="email" type="email" autoComplete="username" required autoFocus />
      </label>
      <label>
        Password
        <input name="password" type="password" autoComplete="current-password" required minLength={12} />
      </label>
      {state.error ? (
        <p className="error" role="alert">
          {state.error}
        </p>
      ) : null}
      <button type="submit" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
      <p className="small muted">
        Accounts are created by an owner. There is no public sign-up and no self-service password reset.
      </p>
    </form>
  );
}
