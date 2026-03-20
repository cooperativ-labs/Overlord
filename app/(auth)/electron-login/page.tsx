import { Suspense } from 'react';

import { ElectronLoginScreen } from '@/components/features/electron-auth/ElectronLoginScreen';

export default function ElectronLoginPage() {
  return (
    <Suspense fallback={<ElectronLoginFallback />}>
      <ElectronLoginScreen />
    </Suspense>
  );
}

function ElectronLoginFallback() {
  return (
    <div className="flex w-full items-center justify-center px-4">
      <div className="flex flex-col w-full max-w-md gap-8 text-center">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight">Overlord</h1>
          <p className="text-muted-foreground">Loading sign in...</p>
        </div>
      </div>
    </div>
  );
}
