// Disposable, synthetic authorized history probe. Never points at application data.
// Run: node --import tsx backend/objective-transcript.bench.ts
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
await bootstrapIntegrationTestDb({
  sqlitePath: path.join(mkdtempSync(path.join(tmpdir(), 'ovld-transcript-probe-')), 'probe.sqlite')
});
const { db, requireDatabaseClient } = await import('./db.ts');
const { createProject, createMission, listMissions } = await import('./repository.ts');
const { listObjectiveTranscript } = await import('./objective-transcript.ts');
process.env.GEMINI_API_KEY = '';

// A loopback transport harness around the actual authorized read services.
// This measures transport/JSON too, but is not the deployed auth middleware or WAN.
const server = createServer((req, res) => {
  const url = new URL(req.url!, 'http://localhost');
  const task =
    url.pathname === '/api/objective-transcript'
      ? listObjectiveTranscript(Object.fromEntries(url.searchParams))
      : listMissions(url.pathname.split('/')[3]!, { includeObjectives: true });
  void task
    .then(body => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    })
    .catch(error => {
      res.statusCode = 500;
      res.end(String(error));
    });
});
if (process.argv.includes('--http'))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));

function insertCopy(table: string, row: Record<string, unknown>) {
  const keys = Object.keys(row);
  db.prepare(
    `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`
  ).run(...Object.values(row));
}

for (const [projects, missions] of [
  [1, 10],
  [10, 1000]
] as const) {
  db.exec(
    'UPDATE objectives SET deleted_at = updated_at; UPDATE missions SET deleted_at = updated_at'
  );
  const projectIds: string[] = [];
  for (let p = 0; p < projects; p++) {
    const project = await createProject({ name: `probe-${missions}-${p}` });
    projectIds.push(project.id);
    const mission = await createMission({
      projectId: project.id,
      firstObjective: 'x'.repeat(4096)
    });
    const template = db.prepare('SELECT * FROM missions WHERE id = ?').get(mission.id) as Record<
      string,
      unknown
    >;
    const objective = db
      .prepare('SELECT * FROM objectives WHERE id = ?')
      .get(mission.objectives[0]!.id) as Record<string, unknown>;
    db.prepare('DELETE FROM objectives WHERE mission_id = ?').run(mission.id);
    // 80% of this still-active backlog is outside Compose's initial display window.
    db.transaction(() => {
      for (let m = 0; m < missions / projects; m++) {
        const id = m === 0 ? mission.id : `${mission.id}-${m}`;
        const at = new Date(Date.now() - (m % 5 === 0 ? 1 : 100) * 86400000).toISOString();
        if (m !== 0)
          insertCopy('missions', {
            ...template,
            id,
            display_id: `${mission.displayId}-${m}`,
            sequence_number: 1000000 + missions * 1000 + p * 100 + m,
            created_at: at,
            updated_at: at
          });
        for (let o = 0; o < 3; o++)
          insertCopy('objectives', {
            ...objective,
            id: `${id}-${o}`,
            mission_id: id,
            position: o + 1,
            display_key: `abc${o}`,
            created_at: at,
            updated_at: at
          });
      }
    })();
  }
  await new Promise<void>(resolve => setImmediate(resolve));
  const client = requireDatabaseClient();
  const originalAll = client.all.bind(client);
  const originalGet = client.get.bind(client);
  let queries = 0;
  let returnedRows = 0;
  client.all = async <T>(...args: Parameters<typeof client.all>) => {
    queries++;
    const rows = await originalAll<T>(...args);
    returnedRows += rows.length;
    return rows;
  };
  client.get = async <T>(...args: Parameters<typeof client.get>) => {
    queries++;
    const row = await originalGet<T>(...args);
    returnedRows += row ? 1 : 0;
    return row;
  };
  const start = performance.now();
  const bodies = await Promise.all(
    projectIds.map(id => listMissions(id, { includeObjectives: true }))
  );
  const bytes = bodies.reduce((sum, body) => sum + Buffer.byteLength(JSON.stringify(body)), 0);
  console.log(
    JSON.stringify({
      mode: 'existing',
      projects,
      missions,
      objectives: missions * 3,
      requests: projects,
      queries,
      returnedRows,
      bytes,
      readAndSerializeMs: +(performance.now() - start).toFixed(2)
    })
  );
  queries = 0;
  returnedRows = 0;
  const boundedStart = performance.now();
  const page = await listObjectiveTranscript();
  const pageBytes = Buffer.byteLength(JSON.stringify(page));
  console.log(
    JSON.stringify({
      mode: 'bounded',
      projects,
      missions,
      objectives: missions * 3,
      requests: 1,
      queries,
      returnedRows,
      items: page.items.length,
      bytes: pageBytes,
      readAndSerializeMs: +(performance.now() - boundedStart).toFixed(2)
    })
  );
  if (server.listening) {
    const address = server.address() as { port: number };
    const base = `http://127.0.0.1:${address.port}`;
    const fetchBody = async (route: string) => {
      const response = await fetch(base + route);
      if (!response.ok) throw new Error(await response.text());
      const body = await response.text();
      JSON.parse(body);
      return Buffer.byteLength(body);
    };
    for (const mode of ['existing', 'bounded']) {
      const times: number[] = [];
      let sampleBytes = 0;
      let sampleQueries = 0;
      let sampleRows = 0;
      for (let sample = 0; sample < 8; sample++) {
        queries = 0;
        returnedRows = 0;
        const start = performance.now();
        sampleBytes =
          mode === 'existing'
            ? (
                await Promise.all(projectIds.map(id => fetchBody(`/api/projects/${id}/missions`)))
              ).reduce((sum, count) => sum + count, 0)
            : await fetchBody('/api/objective-transcript');
        if (sample > 0) times.push(performance.now() - start);
        sampleQueries = queries;
        sampleRows = returnedRows;
      }
      times.sort((a, b) => a - b);
      console.log(
        JSON.stringify({
          mode: `${mode}-loopback`,
          projects,
          missions,
          requests: mode === 'existing' ? projects : 1,
          bytes: sampleBytes,
          queries: sampleQueries,
          returnedRows: sampleRows,
          medianEndToEndMs: +times[3]!.toFixed(2),
          maxEndToEndMs: +times[6]!.toFixed(2)
        })
      );
    }
  }
  client.all = originalAll;
  client.get = originalGet;
}
if (server.listening)
  await new Promise<void>((resolve, reject) =>
    server.close(error => (error ? reject(error) : resolve()))
  );
