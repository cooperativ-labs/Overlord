import type { SlideComponent } from './types';

interface Props {
  Slide: SlideComponent;
  slideNumber: number;
  total: number;
}

export function SlideFrame({ Slide, slideNumber, total }: Props) {
  return (
    <div className="h-full w-full">
      <Slide slideNumber={slideNumber} total={total} />
    </div>
  );
}
