import { Logo } from '@/components/logo';

export function BrandLoading({ label = 'Loading TaskTrack' }: { label?: string }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background">
      <div className="flex items-center justify-center rounded-2xl bg-white p-3 shadow-soft dark:bg-slate-900">
        <Logo size={52} showText={false} />
      </div>
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}
