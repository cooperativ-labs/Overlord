/**
 * The pure agent-session core.
 *
 * No I/O. No network. No filesystem. Everything here is a function from data to data, which is
 * what makes the security-relevant parts testable: "does this leak file contents?" is a
 * question a golden fixture answers, not one a reviewer has to hold in their head while reading
 * a call graph.
 *
 * This module is shared by the CLI adapter runtime and the backend service layer, so both ends
 * of the wire agree on what a normalized event *is* without either owning the definition.
 */

export * from './codec.js';
export * from './decision.js';
export * from './describe/index.js';
export * from './envelope.js';
export * from './inject.js';
export * from './redact.js';
export * from './text.js';
export * from './tool-normalize.js';
export * from './window.js';
