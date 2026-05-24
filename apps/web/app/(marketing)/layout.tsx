import { HomepageFooter } from '@/components/marketing/HomepageFooter';
import { HomepageHeader } from '@/components/marketing/HomepageHeader';

export default function MarketingLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="relative min-h-dvh overflow-y-auto bg-[#f6f4ef] text-stone-900 dark:bg-[#020817] dark:text-white">
      <div className="pointer-events-none absolute inset-x-0 top-0 hidden h-[42rem] dark:block dark:bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.18),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(56,189,248,0.12),_transparent_26%),radial-gradient(circle_at_50%_0%,_rgba(15,23,42,0.6),_transparent_52%),linear-gradient(180deg,rgba(15,23,42,0.85),rgba(2,8,23,0))]" />
      <div className="pointer-events-none absolute inset-x-0 top-24 hidden h-px dark:block dark:bg-linear-to-r dark:from-transparent dark:via-white/12 dark:to-transparent" />

      <div className="relative mx-auto flex max-w-[1800px] flex-col gap-8 px-6 pb-12 sm:px-8 lg:px-12">
        <HomepageHeader />
        <main>{children}</main>
      </div>

      <HomepageFooter />
    </div>
  );
}
