import { Suspense } from 'react';
import { NavLink, Outlet } from 'react-router';
import { CalendarClockIcon, ClipboardListIcon, LayoutDashboardIcon, LogOutIcon, RocketIcon } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ModeToggle } from '@/components/mode-toggle';
import { PersonAvatar } from '@/components/person-avatar';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

const NAV = [
  { to: '/worklogs', label: 'Work logs', icon: CalendarClockIcon },
  { to: '/tasks', label: 'Tasks', icon: ClipboardListIcon },
  { to: '/releases', label: 'Releases', icon: RocketIcon },
];

export function AppShell() {
  const { me, creds, signOut } = useSession();
  return (
    <div className="min-h-svh bg-background">
      <header className="sticky top-0 z-30 border-b bg-card">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
          <NavLink to="/worklogs" className="flex shrink-0 items-center gap-2 font-semibold">
            <LayoutDashboardIcon className="size-5 text-primary" />
            <span className="hidden sm:inline">Jira Dashboard</span>
          </NavLink>
          <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {NAV.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cn(
                    'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
                    isActive && 'bg-accent text-accent-foreground',
                  )
                }
              >
                <Icon className="size-4" />
                {label}
              </NavLink>
            ))}
          </nav>
          <ModeToggle />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full" aria-label="Account">
                <PersonAvatar person={me} className="size-8" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel className="font-normal">
                <div className="font-medium text-foreground">{me.displayName}</div>
                <div className="truncate text-xs text-muted-foreground">{me.email ?? creds.email}</div>
                <div className="truncate text-xs text-muted-foreground">{new URL(creds.site).hostname}</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => signOut()}>
                <LogOutIcon /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        <Suspense
          fallback={
            <div className="grid gap-3">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-64 w-full" />
            </div>
          }
        >
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
