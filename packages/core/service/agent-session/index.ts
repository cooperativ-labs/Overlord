/**
 * The Agent Session Exchange service layer.
 *
 * Shared by the versioned adapter REST surface (`backend/agent-session-routes.ts`) and by the
 * protocol attach path. Route handlers validate and delegate here; they do not write these
 * tables or reimplement these state machines, so the adapter and human surfaces can never
 * disagree about what `released_to_terminal` means.
 */

export * from './channels.js';
export * from './credential.js';
export * from './events.js';
export * from './inputs.js';
export * from './requests.js';
