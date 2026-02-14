import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

const alertVariants = cva(
  'relative w-full rounded-lg border px-4 py-3 text-sm grid gap-1 [&>svg~*]:pl-7 [&>svg]:absolute [&>svg]:top-4 [&>svg]:left-4',
  {
    variants: {
      variant: {
        default: 'bg-card text-card-foreground',
        destructive: 'border-destructive/50 text-destructive'
      }
    },
    defaultVariants: {
      variant: 'default'
    }
  }
);

type AlertProps = React.ComponentProps<'div'> & VariantProps<typeof alertVariants>;

function Alert({ className, variant, ...props }: AlertProps) {
  return <div role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}

function AlertTitle({ className, ...props }: React.ComponentProps<'h5'>) {
  return (
    <h5 className={cn('mb-1 font-medium leading-none tracking-tight', className)} {...props} />
  );
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('text-sm [&_p]:leading-relaxed', className)} {...props} />;
}

export { Alert, AlertDescription, AlertTitle };
