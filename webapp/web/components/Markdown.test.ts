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

describe('Markdown full formatting', () => {
  const render = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }));

  it('nests ordered lists inside ordered lists', () => {
    const html = render('1. a\n   1. a1\n   2. a2\n2. b');
    assert.equal((html.match(/<ol/g) ?? []).length, 2);
    assert.equal((html.match(/<li/g) ?? []).length, 4);
    assert.match(html, /<li>a<ol/);
  });

  it('nests mixed list kinds', () => {
    const html = render('1. a\n   - x\n   - y\n2. b');
    assert.equal((html.match(/<ol/g) ?? []).length, 1);
    assert.equal((html.match(/<ul/g) ?? []).length, 1);
  });

  it('renders bold, italic, strikethrough and inline code', () => {
    const html = render('**b** *i* ~~s~~ `c`');
    assert.match(html, /<strong[^>]*>b<\/strong>/);
    assert.match(html, /<em[^>]*>i<\/em>/);
    assert.match(html, /<del[^>]*>s<\/del>/);
    assert.match(html, /<code[^>]*>c<\/code>/);
  });

  it('nests inline formatting', () => {
    const html = render('***bi*** and **bold with `code`**');
    assert.match(html, /<strong[^>]*><em[^>]*>bi<\/em><\/strong>/);
    assert.match(html, /<strong[^>]*>bold with <code[^>]*>code<\/code><\/strong>/);
  });

  it('renders fenced code blocks verbatim', () => {
    const html = render('```ts\nconst a = **1**;\n```');
    assert.match(html, /<pre[^>]*><code>const a = \*\*1\*\*;<\/code><\/pre>/);
  });
});

describe('Markdown underscore emphasis', () => {
  const render = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }));

  it('keeps snake_case identifiers literal', () => {
    const html = render('The rule in app.request_outstanding_items. Also my_var_name and a_b_c.');
    assert.doesNotMatch(html, /<em/);
    assert.match(html, /app\.request_outstanding_items\./);
    assert.match(html, /my_var_name/);
  });

  it('keeps snake_case literal in headings', () => {
    const html = render('# app.request_outstanding_items.');
    assert.doesNotMatch(html, /<em/);
    assert.match(html, /app\.request_outstanding_items\./);
  });

  it('italicizes underscore text bookended by spaces', () => {
    const html = render('an _italic phrase_ here');
    assert.match(html, /<em[^>]*>italic phrase<\/em>/);
  });

  it('italicizes at the start and end of text and next to punctuation', () => {
    assert.match(render('_start_ of line'), /<em[^>]*>start<\/em>/);
    assert.match(render('end of _line_'), /<em[^>]*>line<\/em>/);
    assert.match(render('see (_this_), ok'), /<em[^>]*>this<\/em>/);
  });

  it('does not treat intraword __dunder__ underscores as bold', () => {
    const html = render('call foo__bar__baz now');
    assert.doesNotMatch(html, /<strong/);
    assert.match(html, /foo__bar__baz/);
  });

  it('still bolds __text__ bookended by spaces', () => {
    assert.match(render('a __bold__ b'), /<strong[^>]*>bold<\/strong>/);
  });

  it('still honors asterisk emphasis inside words', () => {
    assert.match(render('un*frigging*believable'), /<em[^>]*>frigging<\/em>/);
  });
});
