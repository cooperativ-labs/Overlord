'use client';

import * as LabelPrimitive from '@radix-ui/react-label';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

const labelVariants = cva('text-sm leading-none font-medium select-none');

type LabelProps = React.ComponentProps<typeof LabelPrimitive.Root> &
  VariantProps<typeof labelVariants>;

function Label({ className, ...props }: LabelProps) {
  return (
    <LabelPrimitive.Root data-slot="label" className={cn(labelVariants(), className)} {...props} />
  );
}

export { Label };
