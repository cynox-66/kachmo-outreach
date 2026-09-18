import { redirect } from 'next/navigation';
import { getCurrentActor } from '@/server/auth/current-actor';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  // Validated server-side, so a stale cookie shows the form instead of bouncing between /login and /.
  if (await getCurrentActor()) redirect('/');
  return (
    <div className="login">
      <LoginForm />
    </div>
  );
}
