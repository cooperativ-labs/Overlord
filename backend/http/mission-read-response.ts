import type { Response } from 'express';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';

const compressBrotli = promisify(brotliCompress);
const compressGzip = promisify(gzip);
const MIN_COMPRESSION_BYTES = 1024;

/** Send an already authorized board or feed snapshot with Express's weak JSON validator. */
export async function sendMissionReadResponse(
  res: Response,
  payload: unknown,
  cacheControl: 'private, no-cache' | 'private, no-store'
): Promise<void> {
  res.set('Cache-Control', cacheControl);
  res.vary('Accept-Encoding');
  if (cacheControl === 'private, no-cache') {
    res.vary('Authorization');
    res.vary('Cookie');
  }

  const body = Buffer.from(JSON.stringify(payload));
  const etag = res.app.get('etag fn')?.(body);
  if (etag) res.set('ETag', etag);
  if (res.req.fresh) {
    res.status(304).end();
    return;
  }

  res.set('Content-Type', 'application/json; charset=utf-8');
  const encoding = res.req.acceptsEncodings('br', 'gzip', 'identity');
  if (body.length < MIN_COMPRESSION_BYTES || (encoding !== 'br' && encoding !== 'gzip')) {
    res.send(body);
    return;
  }
  const compressed =
    encoding === 'br'
      ? await compressBrotli(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } })
      : await compressGzip(body);
  if (compressed.length < body.length) {
    res.set('Content-Encoding', encoding).send(compressed);
    return;
  }
  res.send(body);
}
