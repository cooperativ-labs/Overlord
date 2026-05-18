export type SlideComponent = React.ComponentType<{ slideNumber: number; total: number }>;

export interface SlideshowDefinition {
  title: string;
  slides: SlideComponent[];
  theme?: 'dark' | 'light';
}
