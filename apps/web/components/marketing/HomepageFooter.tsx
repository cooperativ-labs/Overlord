export function HomepageFooter() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="mx-auto w-full max-w-6xl px-4 pb-4 pt-2 text-left text-xs text-slate-500">
      Copyright {currentYear}, United States of America
    </footer>
  );
}
