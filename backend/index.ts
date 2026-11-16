// Backend entrypoint. `./app.ts` builds the Express application (every route
// and middleware) without listening; this module starts it. Keeping the two
// apart lets tooling such as `scripts/list-rest-routes.mts` load the app and
// walk its router stack without opening a port. Loading it is not free of side
// effects: configuration is read and, on SQLite, the database is opened and
// migrated at import time (`db.ts`), and signal handlers are registered.
import { start } from './app.ts';

void start();
