import { createContext } from 'react';

/** Account scope for project resource responses that contain private host links. */
export const ResourceAccountContext = createContext<string | null>(null);
