import { readFileSync } from 'node:fs';
import { sdkGeminiClient } from '../../../backend/chat/gemini-client.ts';
const key = readFileSync('.env.local', 'utf8').split('\n').find(l => l.startsWith('GEMINI_API_KEY='))!.slice(15).trim().replace(/^['"]|['"]$/g, '');
const c = sdkGeminiClient(key);
try {
  const r = await c.generate({ model: 'gemini-3.8-flash', contents: [{ role: 'user', parts: [{ text: 'We discussed offline support; decided to queue writes.' }] }, { role: 'model', parts: [{ text: 'OK' }] }, { role: 'user', parts: [{ text: 'Write a compact summary.' }] }],
    config: { systemInstruction: 'Be brief.', responseMimeType: 'application/json', responseJsonSchema: { type: 'object', properties: { text: { type: 'string' }, decisions: { type: 'array', items: { type: 'string' } }, openQuestions: { type: 'array', items: { type: 'string' } }, evidenceRefs: { type: 'array', items: { type: 'string' } } }, required: ['text', 'decisions', 'openQuestions', 'evidenceRefs'] }, maxOutputTokens: 1024 } });
  console.log('ok', r.text.slice(0, 300));
} catch (e) { console.log('err', (e as any).status, String((e as any).message).slice(0, 400)); }
