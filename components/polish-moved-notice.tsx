import Link from 'next/link';
import { ArrowRight, PenLine } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * "Polish my writing" overlapped with Rewrite Coach, so it now lives there. Students who
 * unlocked it see this note instead, pointing them to the tool that replaces it.
 */
export function PolishMovedNotice() {
  return (
    <div className="mx-auto max-w-xl py-6 text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
        <PenLine className="h-6 w-6 text-primary" />
      </span>
      <h2 className="mt-4 text-xl font-bold">Polish my writing is now part of Rewrite Coach</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Rewrite Coach does everything Polish did (clearer, more concise, better grammar, a more academic tone) and
        shows each edit so you choose what to keep. You also get more runs a day: 5 on Free and 20 on Premium.
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        Open any task, then choose <strong>Rewrite Coach</strong> from its menu and paste your draft.
      </p>
      <Button asChild className="mt-5">
        <Link href="/app/tasks">
          Go to my tasks <ArrowRight className="ml-2 h-4 w-4" />
        </Link>
      </Button>
    </div>
  );
}
