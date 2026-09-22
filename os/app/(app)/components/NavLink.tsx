'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * A navigation link that knows when it is the current page (`aria-current="page"`), so the operator always sees where
 * they are. Presentation only: which links exist is decided on the server, from the actor's permissions.
 */
export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname() ?? '/';
  const current = href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link href={href} aria-current={current ? 'page' : undefined}>
      {children}
    </Link>
  );
}
