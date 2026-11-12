// Conformance records for the backend test suite (ADR 0051). When
// `OVERLORD_API_CONFORMANCE_REPORT` names a file, the request-validation layer and
// the response checker append one JSON line per observation to it; the test runner
// wrapper (`scripts/api-conformance-report.mjs`) summarises the file and fails the
// run on a non-conforming response or an invalid request a handler accepted. The
// variable is unset in production, where nothing is recorded.
import { appendFileSync } from 'node:fs';

export const CONFORMANCE_REPORT_ENV = 'OVERLORD_API_CONFORMANCE_REPORT';

export type ConformanceRecord =
  | {
      kind: 'request';
      operationId: string;
      method: string;
      outcome: string;
      status: number;
      issues: { in: string; path: string; code: string }[];
    }
  | {
      kind: 'response';
      operationId: string;
      method: string;
      status: number;
      mediaType: string | null;
      problems: string[];
    };

export function conformanceReportPath(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env[CONFORMANCE_REPORT_ENV]?.trim();
  return value ? value : null;
}

export function recordConformance(record: ConformanceRecord): void {
  const file = conformanceReportPath();
  if (!file) return;
  appendFileSync(file, `${JSON.stringify(record)}\n`);
}
