import * as React from 'react';

import { cn } from '@/lib/utils';

export interface MarkdownIconProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string;
}

export function MarkdownIcon({ className, size = 16, ...props }: MarkdownIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('lucide lucide-file-markdown shrink-0', className)}
      {...props}
    >
      {/* Outer file shape */}
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      {/* Markdown letter M */}
      <path d="M8 12v4" />
      <path d="M8 12l2 2 2-2" />
      <path d="M12 12v4" />
      {/* Down arrow */}
      <path d="M16 12v4" />
      <path d="M14.5 14.5l1.5 1.5 1.5-1.5" />
    </svg>
  );
}
