import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import type { Person } from '../../shared/types';

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

export function PersonAvatar({ person, className }: { person: Pick<Person, 'displayName' | 'avatarUrl'>; className?: string }) {
  return (
    <Avatar className={cn('size-6', className)}>
      {person.avatarUrl && <AvatarImage src={person.avatarUrl} alt="" />}
      <AvatarFallback className="text-[10px] font-semibold">{initials(person.displayName)}</AvatarFallback>
    </Avatar>
  );
}
