import { ProtectedRoute } from '@/components/protected-route';
import { AppChrome } from '@/components/app-chrome';
import { ConsentGate } from '@/components/consent-gate';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      <ConsentGate>
        <AppChrome>{children}</AppChrome>
      </ConsentGate>
    </ProtectedRoute>
  );
}
