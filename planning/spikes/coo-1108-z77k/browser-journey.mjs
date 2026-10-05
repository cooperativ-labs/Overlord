/* eslint-disable no-undef, no-console -- acceptance harness, runs in Node and in the page */
// coo:1108.z77k browser journey against the scratch stack (headless Chromium, cached Playwright).
// Not production code. Playwright is not a repository dependency: the import path below is the
// npx cache on the machine that ran the acceptance pass; point it at any Playwright install.
// Start Vite with OVERLORD_WEB_PORT set to the scratch backend port and OVERLORD_WEB_DEV_PORT
// in 4310-4360 (a trusted origin), without rewriting webapp/public/runtime-config.js.
// Usage: node browser-journey.mjs <mode: same-origin|remote|local> <base> <email> [apiBase]
import { writeFileSync } from 'node:fs';
import { chromium } from '/Users/jake/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';
const [mode, base, email, apiBase] = process.argv.slice(2);
const shots = process.env.ACCEPTANCE_SHOTS_DIR ? process.env.ACCEPTANCE_SHOTS_DIR.replace(/\/?$/, '/') : new URL('./shots/', import.meta.url).pathname;
const results = [];
const check = (id, title, ok, detail = {}) => { results.push({ id, title, status: ok ? 'pass' : 'fail', detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${title}${ok ? '' : ' ' + JSON.stringify(detail)}`); };
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1320, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 240)); });
page.on('pageerror', e => errors.push('pageerror: ' + String(e.message).slice(0, 240)));
const bad = [], chatCalls = [];
page.on('response', r => { const u = new URL(r.url()); if (/^\/api\/(chat|connections)/.test(u.pathname)) chatCalls.push(`${r.status()} ${u.pathname}`); if (r.status() >= 400 && u.pathname.startsWith('/api/')) bad.push(`${r.status()} ${u.pathname}`); });
if (mode === 'remote') {
  // Desktop Remote mode loads this same SPA with a cross-origin API base and bearer sessions.
  await context.route('**/runtime-config.js', route => route.fulfill({ contentType: 'application/javascript', body: `window.__OVERLORD_RUNTIME__ = ${JSON.stringify({ apiBaseUrl: apiBase })};\n` }));
}
const body = () => page.innerText('body');
const waitText = async (re, timeout = 240_000) => { const end = Date.now() + timeout; for (;;) { const t = await body(); if (re.test(t)) return t; if (Date.now() > end) throw new Error('timeout waiting for ' + re); await page.waitForTimeout(400); } };
try {
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.fill('#auth-email', email);
  await page.fill('#auth-password', 'Acceptance-Passw0rd!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForFunction(() => !location.search.includes('mode=sign-in'), null, { timeout: 30_000 });
  await page.waitForLoadState('networkidle');
  await waitText(/Inbox/, 30_000);
  // A fresh account is offered a "New project" dialog; dismiss it so the page is interactive.
  if (/Create project/.test(await body())) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
  const chatLink = page.locator('a[href="/chat"]').first();
  const inboxLink = page.locator('a[href="/inbox"]').first();
  const chatBox = await chatLink.boundingBox(), inboxBox = await inboxLink.boundingBox();
  check(`${mode}.nav`, 'Chat entry sits directly above Inbox in the sidebar', Boolean(chatBox && inboxBox) && chatBox.y < inboxBox.y && inboxBox.y - chatBox.y < 60, { chatY: chatBox?.y, inboxY: inboxBox?.y });
  await chatLink.click();
  await page.waitForLoadState('networkidle');
  if (mode === 'local') {
    const text = await waitText(/Chat is unavailable/, 20_000);
    check('local.unavailable', 'Local mode shows Chat as unavailable', /Chat is unavailable/.test(text), {});
    check('local.no-composer', 'No composer or thread list is offered', (await page.$$('[aria-label="Message"]')).length === 0, {});
    await page.screenshot({ path: shots + 'local-unavailable.png' });
    check('local.no-chat-calls', 'The SPA makes no chat or connection request in Local mode', chatCalls.length === 0, { chatCalls });
    check('local.no-errors', 'No page errors and no failing chat request in Local mode', errors.filter(e => /pageerror/.test(e)).length === 0 && !bad.some(b => /chat|connections/.test(b)), { otherFailingRequests: [...new Set(bad)] });
  } else {
    await waitText(/gemini-3\.8-flash/, 20_000).catch(() => null);
    const ready = await body();
    check(`${mode}.readiness`, 'Provider readiness is shown', /gemini-3\.8-flash/i.test(ready) && /ready/i.test(ready), {});
    await page.screenshot({ path: shots + `${mode}-chat-home.png` });
    // New conversation: streamed answer.
    await page.getByLabel('New conversation').click();
    const stamp = `${mode}-${Date.now().toString(36)}`;
    await page.getByLabel('Message').fill(`Reply with exactly: pong ${stamp}. Do not use tools.`);
    await page.getByLabel('Send').click();
    await waitText(new RegExp(`pong ${stamp}[\\s\\S]*pong ${stamp}`), 120_000); // the request and the reply
    check(`${mode}.streamed-answer`, 'A new conversation streams an answer into the transcript', true, {});
    // Proposal card with frozen assignment, then Create.
    await page.getByLabel('Message').fill('Prepare a draft mission now, without asking me anything else: in the Sandbox Service project, primary resource, one objective to add a GET /version endpoint. Use agent codex with model gpt-5.5 and medium reasoning.');
    await page.getByLabel('Send').click();
    await waitText(/Create drafts/, 240_000);
    const card = await body();
    check(`${mode}.proposal-card`, 'The proposal card shows project, frozen agent and model, and a Create button', /Sandbox Service/.test(card) && /codex/i.test(card) && /gpt-5\.5/.test(card), {});
    await page.screenshot({ path: shots + `${mode}-proposal.png`, fullPage: true });
    await page.getByRole('button', { name: 'Create drafts' }).click();
    await waitText(/eng:\d+/, 60_000);
    const created = await body();
    const display = created.match(/eng:\d+/)?.[0];
    check(`${mode}.created`, 'Create shows the created draft with its mission id; Create is no longer offered', Boolean(display) && !/Create drafts/.test(created), { display });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitText(/eng:\d+/, 30_000);
    const reloaded = await body();
    check(`${mode}.receipt-after-reload`, 'After a reload the receipt is still shown and Create is not offered again', reloaded.includes(display) && !/Create drafts/.test(reloaded), {});
    await page.screenshot({ path: shots + `${mode}-created.png`, fullPage: true });
    // An earlier research thread whose source access was revoked renders a placeholder.
    const research = page.getByText(/What would adding offline support/).first();
    if (await research.count()) {
      await research.click();
      await page.waitForTimeout(3000);
      const old = await body();
      check(`${mode}.revoked-content`, 'A thread whose sources were revoked shows a withheld-content placeholder, not the old answer', /no longer available|unavailable|access/i.test(old) && !/OfflineObjectiveStore only queues/.test(old), {});
      await page.screenshot({ path: shots + `${mode}-revoked-thread.png`, fullPage: true });
    }
    // Connected accounts surface.
    await page.goto(base + '/settings/connections', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const connections = await body();
    check(`${mode}.connections`, 'The connected-accounts page offers the Knowledgebase connection', /Knowledgebase/i.test(connections), {});
    const real = errors.filter(e => /pageerror/.test(e));
    check(`${mode}.no-errors`, 'No page errors and no failing chat or connection request', real.length === 0 && !bad.some(b => /chat|connections/.test(b)), { errors: real.slice(0, 5), otherFailingRequests: [...new Set(bad)] });
  }
} catch (error) {
  check(`${mode}.error`, 'Journey did not finish', false, { error: String(error?.message ?? error).slice(0, 400), text: (await body().catch(() => '')).slice(0, 600), errors: errors.slice(0, 5) });
  await page.screenshot({ path: shots + `${mode}-failure.png`, fullPage: true }).catch(() => {});
}
writeFileSync(new URL(`./browser-${mode}.json`, import.meta.url), JSON.stringify({ mode, base, finishedAt: new Date().toISOString(), results }, null, 2));
await browser.close();
process.exit(results.some(r => r.status === 'fail') ? 1 : 0);
