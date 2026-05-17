import Link from 'next/link';

export function HomepageFooter() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 pb-4 pt-2 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
      <p>Copyright {currentYear}, United States of America</p>
      <nav aria-label="Marketing footer" className="flex flex-wrap gap-x-4 gap-y-2">
        <Link href="/compare" className="hover:text-slate-300">
          Compare
        </Link>
        <Link href="/docs" className="hover:text-slate-300">
          Docs
        </Link>
        <Link href="/docs/for-agents" className="hover:text-slate-300">
          For agents
        </Link>
        <Link href="/llms.txt" className="hover:text-slate-300">
          llms.txt
        </Link>
      </nav>
    </footer>
  );
}
