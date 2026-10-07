# Diagnostic paging compression benchmark — 2026-10-07

## Decision

**No-go for enabling compression in the diagnostics route from this benchmark.** A local microbenchmark shows that compression can save substantial transfer bytes, but the available production audit retained aggregate row counts and total payload bytes rather than raw diagnostic pages. The generated payloads below are therefore sensitivity probes, not representative captures. They cannot establish the actual CPU/latency tradeoff for authenticated pages, proxies, or clients. No runtime or contract change was made.

Transport compression saves **zero model tokens** and does not reduce provider cost or context occupancy.

## Baseline and method

The owner-authorized audit included 377 rows totaling 4,050,332 payload bytes in one thread, an average of 10,744 bytes per row. I used that average to size 10-row and 100-row JSON pages (about 107 KB and 1.07 MB). Each page contained the current diagnostic entry/page shape and repeated metadata. Payload text was tested as (a) repeated prose and (b) deterministic SHA-256 text to approximate high-entropy source content. The test used Node's built-in synchronous gzip level 6 and Brotli quality 4, five warmups and 25 measurements, with median encode/decode CPU. Round trips were byte-identical. Transfer savings are calculated at ideal 10 and 100 Mbps; they exclude RTT, TLS, proxy behavior, queueing and contention.

| Page profile | Plain bytes | Codec | Encoded bytes | Ratio | Server encode CPU | Client decode CPU | Ideal transfer saved at 10 / 100 Mbps |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 10 rows, repeated prose | 107,457 | gzip-6 | 981 | 0.9% | 0.25 ms | 0.03 ms | 85.2 / 8.5 ms |
| 10 rows, repeated prose | 107,457 | Brotli-4 | 517 | 0.5% | 0.11 ms | 0.04 ms | 85.6 / 8.6 ms |
| 10 rows, high-entropy text | 107,457 | gzip-6 | 41,502 | 38.6% | 1.82 ms | 0.21 ms | 52.8 / 5.3 ms |
| 10 rows, high-entropy text | 107,457 | Brotli-4 | 36,429 | 33.9% | 0.54 ms | 0.24 ms | 56.8 / 5.7 ms |
| 100 rows, repeated prose | 1,074,324 | gzip-6 | 5,779 | 0.5% | 2.40 ms | 0.32 ms | 854.8 / 85.5 ms |
| 100 rows, repeated prose | 1,074,324 | Brotli-4 | 1,769 | 0.2% | 0.89 ms | 0.34 ms | 858.0 / 85.8 ms |

The repeated-prose ratio is an optimistic bound and should not be used for capacity planning. The 100-row high-entropy case did not complete within the benchmark command's execution window, so no result is reported for it. Measurements ran on one local Node host; synchronous zlib CPU is not production server/client CPU under concurrency.

## Route and contract observations

`GET /api/chat/threads/:id/diagnostics` currently sets `Cache-Control: no-store`, validates the cursor, and delegates to the existing owner-scoped diagnostics service. There is no Express response-compression middleware in the backend. The route returns JSON pages, while chat SSE uses separate routes. Source inspection supports preserving those behaviors, but this run did not make authenticated HTTP requests, compare wire headers, exercise pagination over compressed responses, or test SSE under middleware. Thus no-store/auth behavior is unchanged by this documentation-only decision; runtime behavior was not independently exercised here.

No contract or schema change is indicated for transparent negotiated content encoding. Any follow-up implementation should scope negotiation to diagnostics JSON, preserve the existing no-store and authorization gates, verify full decoded JSON and cursor paging, and prove ordinary chat SSE remains unbuffered. Benchmarking should use complete owner-authorized page bodies at several sizes and concurrent request load on the actual deployment path, recording response bytes, server/client CPU, and end-to-end page latency. Enable only if those measurements show a consistent user-visible benefit with acceptable CPU cost.
