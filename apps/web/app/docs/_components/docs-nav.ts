export type DocsNavItem = {
  title: string;
  url: string;
};

export type DocsNavSection = {
  title: string;
  url: string;
  items?: DocsNavItem[];
};

export type DocsNavData = {
  navMain: DocsNavSection[];
};
