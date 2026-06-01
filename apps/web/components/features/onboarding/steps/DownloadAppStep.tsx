'use client';

import { Check, Download, Monitor, Terminal, Zap } from 'lucide-react';

import { useElectron } from '@/components/features/terminal/useElectron';
import { Button } from '@/components/ui/button';

type Props = {
  onContinue: () => void;
  /** Override the default heading text. */
  title?: string;
};

// We use the downloads page for actual version resolution so the version is
// always current.
const DOWNLOAD_PAGE = '/downloads';

const BENEFITS = [
  {
    icon: Terminal,
    title: 'Agents launch right in your terminal',
    description:
      'Click the Run button on any ticket and a terminal opens in your project directory — no copy-pasting commands.'
  },
  {
    icon: Zap,
    title: 'File changes are linked automatically',
    description:
      'The desktop app watches your filesystem and associates code changes with the right Overlord ticket in real time.'
  },
  {
    icon: Monitor,
    title: 'Manage multiple agents side-by-side',
    description:
      'See all running agent terminals at once, pause or interrupt them, and switch context without leaving the app.'
  }
];

export function DownloadAppStep({ onContinue, title }: Props) {
  const { isElectron } = useElectron();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">
          {title ?? (isElectron ? 'You have the full experience' : 'Download the Desktop App')}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {isElectron
            ? "You're already running the Overlord desktop app — all features are available."
            : 'The desktop app lets agents run directly in your terminal, with automatic file-change tracking.'}
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {BENEFITS.map(({ icon: Icon, title, description }) => (
          <div key={title} className="flex items-start gap-3">
            <div className="bg-primary/10 text-primary mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
              {isElectron ? (
                <Check className="h-4 w-4 text-emerald-600" />
              ) : (
                <Icon className="h-4 w-4" />
              )}
            </div>
            <div>
              <p className="text-sm font-medium">{title}</p>
              <p className="text-muted-foreground text-sm">{description}</p>
            </div>
          </div>
        ))}
      </div>

      {isElectron ? (
        <Button onClick={onContinue} className="self-start">
          <Check className="h-4 w-4" />
          Continue
        </Button>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button asChild>
              <a href={DOWNLOAD_PAGE} target="_blank" rel="noopener noreferrer">
                <Download className="h-4 w-4" />
                Download for macOS
              </a>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onContinue}
              className="text-muted-foreground"
            >
              Continue without desktop app →
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            After downloading, open the app and sign in with the same account — it installs the CLI
            and guides you through setup. Or continue here and we'll help you set up the CLI
            yourself.
          </p>
        </div>
      )}
    </div>
  );
}
