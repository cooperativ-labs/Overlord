'use client';

import { Check, Loader2 } from 'lucide-react';
import { type ReactNode } from 'react';

import { Button, type ButtonProps } from '@/components/ui/button';

export type ButtonLoadingState = 'default' | 'loading' | 'success' | 'error' | 'disabled';

type LoadingButtonProps = Omit<ButtonProps, 'onClick'> & {
  buttonState: ButtonLoadingState;
  setButtonState?: (state: ButtonLoadingState) => void;
  text: ReactNode;
  loadingText?: ReactNode;
  successText?: ReactNode;
  errorText?: ReactNode;
  reset?: boolean;
  onClick?: () => void | Promise<void>;
};

export function LoadingButton({
  buttonState,
  setButtonState,
  text,
  loadingText,
  successText,
  errorText,
  reset = false,
  onClick,
  ...props
}: LoadingButtonProps) {
  const isLoading = buttonState === 'loading';
  const isDisabled = buttonState === 'disabled' || isLoading;

  async function handleClick() {
    if (isDisabled || !onClick) return;
    await onClick();
    if (reset && setButtonState) {
      setTimeout(() => setButtonState('default'), 2000);
    }
  }

  function getContent() {
    switch (buttonState) {
      case 'loading':
        return loadingText ?? <Loader2 className="size-4 animate-spin" />;
      case 'success':
        return successText ?? <Check className="size-4" />;
      case 'error':
        return errorText ?? text;
      default:
        return text;
    }
  }

  return (
    <Button {...props} disabled={isDisabled} onClick={handleClick}>
      {getContent()}
    </Button>
  );
}
