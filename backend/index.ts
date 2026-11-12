// Backend entrypoint. `./app.ts` builds the Express application (every route
// and middleware) without listening; this module starts it. Keeping the two
// apart lets tooling such as `scripts/list-rest-routes.mts` load the app and
// walk its router stack without opening a port or a database connection.
import { start } from './app.ts';

void start();
