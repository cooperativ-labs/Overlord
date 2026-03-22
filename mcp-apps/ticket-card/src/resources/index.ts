import { createResourceExports } from 'sunpeak';

const resourceModules = import.meta.glob(['./*/*.tsx', '!./*/*.test.tsx'], { eager: true });

export default createResourceExports(resourceModules);
