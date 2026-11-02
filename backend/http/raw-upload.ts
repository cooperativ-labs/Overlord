// Raw-body upload transport. The SPA streams a single File as the request body
// with the filename in an `x-upload-filename` header, so the server records it
// without multipart parsing. This module is the one declaration of which routes
// take a raw body (and their byte ceilings) and the one parser that turns such a
// request into the `{ bytes, filename, contentType }` shape the storage writers
// accept.
import express, { type Request, type RequestHandler } from 'express';

import { MAX_ATTACHMENT_BYTES, MAX_IMAGE_BYTES, type UploadImageInput } from '../storage.ts';

export interface RawUploadRoute {
  /** Matched against `req.path` for POST requests. */
  pattern: RegExp;
  maxBytes: number;
}

export const IMAGE_UPLOAD_ROUTE: RawUploadRoute = {
  pattern: /^\/api\/uploads\//,
  maxBytes: MAX_IMAGE_BYTES
};

export const ATTACHMENT_UPLOAD_ROUTE: RawUploadRoute = {
  pattern: /^\/api\/(?:objectives|inbox)\/[^/]+\/attachments$/,
  maxBytes: MAX_ATTACHMENT_BYTES
};

export const RAW_UPLOAD_ROUTES: readonly RawUploadRoute[] = [
  IMAGE_UPLOAD_ROUTE,
  ATTACHMENT_UPLOAD_ROUTE
];

/** True when the global JSON parser must skip this request. */
export function isRawUploadRequest(req: Request): boolean {
  return req.method === 'POST' && RAW_UPLOAD_ROUTES.some(route => route.pattern.test(req.path));
}

/** Route-level `express.raw` parser accepting any content type up to the route's ceiling. */
export function rawUploadBody(route: RawUploadRoute): RequestHandler {
  return express.raw({ type: () => true, limit: route.maxBytes });
}

export function readRawUpload(req: Request, defaultFilename: string): UploadImageInput {
  const headerName = req.header('x-upload-filename');
  return {
    bytes: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
    filename: headerName ? decodeURIComponent(headerName) : defaultFilename,
    contentType: req.header('content-type') ?? ''
  };
}
