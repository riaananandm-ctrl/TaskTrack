import { ProtectedRoute } from '@/components/protected-route';
import { AppChrome } from '@/components/app-chrome';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      <AppChrome>{children}</AppChrome>
    </ProtectedRoute>
  );
}
