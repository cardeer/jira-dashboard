import { createContext, useContext } from 'react';
import type { Credentials, Me } from '../../shared/types';

export interface Session {
  creds: Credentials;
  me: Me;
  signOut: (message?: string) => void;
  /** Call when Jira rejects the stored token: signs out with an explanation. */
  onUnauthorized: () => void;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession must be used inside a signed-in route');
  return s;
}
