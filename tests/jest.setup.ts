import { config as loadDotenv } from 'dotenv';
import path from 'path';

loadDotenv({ path: path.join(__dirname, '../apps/web/.env.local') });
