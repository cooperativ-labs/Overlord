'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';

import { Button } from './button';

interface Props {
  children?: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('Uncaught error:', error, errorInfo);
    }
    this.setState({ errorInfo });
  }

  public render() {
    if (this.state.hasError) {
      if (this.fallback) {
        return this.fallback;
      }

      const { error, errorInfo } = this.state;
      const fullTrace = [error?.stack, errorInfo?.componentStack].filter(Boolean).join('\n\n');

      return (
        <div className="flex h-full min-h-[200px] w-full flex-col items-center justify-center gap-4 rounded-lg border border-destructive/20 bg-destructive/5 p-6 text-center">
          <div className="space-y-2">
            <h3 className="text-lg font-semibold text-destructive">Something went wrong</h3>
            <div className="flex items-center justify-center gap-2">
              <p className="max-w-[400px] text-sm text-muted-foreground">
                {error?.message || 'An unexpected error occurred.'}
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 shrink-0 p-0 text-muted-foreground hover:text-foreground"
                title="Copy full stack trace"
                onClick={() => navigator.clipboard.writeText(fullTrace)}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                  <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                </svg>
              </Button>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => this.setState({ hasError: false, error: null, errorInfo: null })}
          >
            Try again
          </Button>
        </div>
      );
    }

    return this.props.children;
  }

  private get fallback() {
    return this.props.fallback;
  }
}
