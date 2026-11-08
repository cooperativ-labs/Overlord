import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { Markdown } from './Markdown.tsx';

describe('Markdown', () => {
  it('renders a paragraph containing a pipe without treating it as a table', () => {
    const html = renderToStaticMarkup(createElement(Markdown, { text: 'alpha | beta' }));

    assert.match(html, /alpha \| beta/);
  });

  it('renders a pipe line followed by ordinary text without stalling', () => {
    const html = renderToStaticMarkup(
      createElement(Markdown, { text: 'alpha | beta\nordinary continuation' })
    );

    assert.match(html, /alpha \| beta/);
    assert.match(html, /ordinary continuation/);
  });

  it('keeps one ordered list when items are separated by blank lines', () => {
    const html = renderToStaticMarkup(
      createElement(Markdown, { text: '1. one\n\n2. two\n\n3. three' })
    );

    assert.equal((html.match(/<ol/g) ?? []).length, 1);
    assert.equal((html.match(/<li/g) ?? []).length, 3);
  });

  it('honors the starting number of an ordered list', () => {
    const html = renderToStaticMarkup(createElement(Markdown, { text: '3. three\n4. four' }));

    assert.match(html, /<ol[^>]*start="3"/);
  });

  it('still renders valid markdown tables', () => {
    const html = renderToStaticMarkup(
      createElement(Markdown, { text: '| Name | Value |\n| --- | --- |\n| one | two |' })
    );

    assert.match(html, /<table/);
    assert.match(html, /<th[^>]*>Name<\/th>/);
    assert.match(html, /<td[^>]*>two<\/td>/);
  });
});
