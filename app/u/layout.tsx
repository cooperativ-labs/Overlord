import { ErrorBoundary } from '@/components/ui/error-boundary';

type LayoutProps = {
  children: React.ReactNode;
};

export default function UserLayout({ children }: LayoutProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ErrorBoundary>{children}</ErrorBoundary>
    </div>
  );
}
