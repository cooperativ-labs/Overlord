# Overlord Cloud backend egress, November 21, 2026

**Decision:** Keep `presignReads` disabled. Project mission lists, activity feeds and sync catch-up dominate sampled response bytes. Media generated little traffic even on the active deployment, where its share was highest among the sampled deployments.

**Contract impact: none.** This investigation changes no runtime behavior, interface, storage setting or access rule. The checked-out contract is `182.0.0`.

## Production measurements

The objective's November 21 billing snapshot showed **$5.36** in backend egress and **$0.45** for all Overlord volumes in the October 25–November 25 billing period to date. Railway's `NETWORK_TX_GB` points for `overlord-cloud / production / overlord-backend` summed to **119.41 decimal GB** across 166 four-hour bins requested from October 25 00:00 UTC through November 21 14:05 UTC. These public-network counters and the billing snapshot are independent measurements.

Railway returned **141,565** HTTP log records across 32 deployments with data, from October 25 10:45 UTC through November 21 14:04 UTC. The sample took up to the latest 5,000 available rows per deployment and grouped the edge `txBytes` field by route, with project IDs normalized. The cap favors the end of long-lived deployments. The 2.395 GB covered by the sample cannot allocate the full 119.41 GB or account for all traffic outside the HTTP edge. [Railway log fields](https://docs.railway.com/observability/logs) · [Railway network metrics](https://docs.railway.com/cli/metrics)

| Traffic | Requests | Response MB | Share of sampled HTTP bytes |
| --- | ---: | ---: | ---: |
| `/sync/changes` | 7,570 | 1,352.92 | 56.48% |
| `/api/activity-feed` | 2,843 | 648.41 | 27.07% |
| `/api/projects/:id/missions` | 3,472 | 297.96 | 12.44% |
| `/api/storage/*` | 10 | 1.31 | 0.055% |

Two time-bounded checks show why the deployments should be read separately.

- **November 20, 13:00 UTC, 60 seconds.** 2,402 requests returned 147.87 MB, including 119.46 MB from 654 successful sync catch-up responses. Storage transferred zero bytes in this window.
- **November 21, 13:40–14:05 UTC, active deployment.** 3,987 requests returned 106.47 MB. Successful project API responses carried 92.31 MB (86.7%), while media carried 1.31 MB (1.23%). Across the wider sample, `/api/projects/:id/missions` accounted for nearly all of the projects API bytes.

To repeat the attribution, list production deployments with `railway deployment list --limit 60 --json`. For each active or removed deployment, use its deployment ID and the same time boundaries with `railway logs <deployment-id> --http --since <start> --until <end> --lines 5000 --json`. Sum `txBytes` by path family after stripping query strings and replacing resource IDs, and record any capped windows. Use `railway metrics --network --raw --json` against the same backend service and window for the public-network counter. The service-only HTTP CLI query reads the latest deployment, so historical samples need explicit deployment IDs.

## Storage rollout and verification

A read-only query grouped live `storage_buckets` rows by bucket key, backend and `settings_json.presignReads`. Attachments, user images and workspace images each had 22 S3 rows using HTTPS endpoints. Organization images had 18 `local_fs` rows. None of the 84 live rows had `presignReads` set to boolean `true` or a `presignTtlSeconds` value. No production configuration or deployment was made.

The existing read path resolves the active organization or the object's workspace, enforces the bucket's read permission, and checks project-automation attachment scope and unpromoted Inbox ownership before signing. A new request must pass the current authorization checks. A URL already issued remains a bearer grant until it expires, subject to provider or object revocation. S3 GET signing defaults to 300 seconds and clamps configured values to 60–300 seconds. The `302` uses `Cache-Control: private, no-store` and signs an attachment disposition when required. Web downloads use the storage link, the CLI's `--output` uses the backend byte client, and iOS uses `URLSession` for backend downloads. These are source checks, and the existing storage suite passed all 14 tests, including mock-S3 signing, TTL bounds, and workspace and organization storage checks. The contract and all 13 conformance manifests passed.

The four successful production image responses took 221–548 ms at the edge. The other six storage requests returned 204 and carried zero response bytes. Ideal offload of every storage response in the sample would have removed at most **1.31 MB** of backend HTTP responses before accounting for redirect overhead. There is no observed egress or latency saving because the rollout criterion was unmet. A rollout would need live-client verification of cross-origin redirects and authorization-header handling, final attachment headers, provider expiry and range responses, plus access revocation checks at issuance. Those checks were outside the production path exercised in this investigation.
