import { toNextJsHandler } from 'better-auth/next-js';
import { getServer } from '@/server/auth/instance';

/** Better Auth's own endpoints (sign-in, sign-out, session). Rate limiting and origin checks live inside it. */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return toNextJsHandler(getServer().auth).GET(request);
}

export async function POST(request: Request) {
  return toNextJsHandler(getServer().auth).POST(request);
}
