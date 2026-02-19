import { InboxList } from '@/components/features/InboxList';

export default function InboxPage() {
  return (
    <div className="flex min-h-0 flex-1 w-full overflow-hidden">
      <InboxList />
      <div className="bg-background flex min-w-0 flex-1 flex-col" />
    </div>
  );
}
