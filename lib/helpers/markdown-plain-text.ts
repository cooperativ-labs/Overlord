import { Children, isValidElement, type ReactNode } from 'react';

/** Extract plain text from ReactMarkdown heading children for slug generation. */
export function getPlainTextFromReactNode(node: ReactNode): string {
  return Children.toArray(node)
    .map(child => {
      if (typeof child === 'string') {
        return child;
      }
      if (typeof child === 'number') {
        return String(child);
      }
      if (isValidElement<{ children?: ReactNode }>(child)) {
        return getPlainTextFromReactNode(child.props.children);
      }
      return '';
    })
    .join('');
}
