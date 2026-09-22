'use client';

import { useActionState, startTransition, type FormEvent } from 'react';
import { signInAction, type SignInState } from '@/server/auth/actions';

/**
 * The form only collects input and shows the server's message; it makes no authorization decision. Submitted through a
 * transition so a mistyped password does not also clear the email address.
 */
export function LoginForm() {
  const [state, dispatch, pending] = useActionState<SignInState, FormData>(signInAction, {});
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    startTransition(() => dispatch(data));
  };
  return (
    <div className="login-card">
      <p className="wordmark">KACHMO</p>
      <span className="label">Outbound · private</span>
      <form onSubmit={onSubmit}>
        <label>
          Email
          <input name="email" type="email" autoComplete="username" required autoFocus />
        </label>
        <label>
          Password
          <input name="password" type="password" autoComplete="current-password" required minLength={12} />
        </label>
        {state.error ? (
          <p className="notice" role="alert" style={{ margin: 0 }}>
            {state.error}
          </p>
        ) : null}
        <button type="submit" className="btn-act" disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="small muted">Accounts are created by an owner. There is no public sign-up and no self-service password reset.</p>
      </form>
    </div>
  );
}
