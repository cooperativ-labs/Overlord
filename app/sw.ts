import { defaultCache } from '@serwist/next/worker';
import { Serwist } from 'serwist';

declare const self: ServiceWorkerGlobalScope & {
  __SERWIST_PRECACHE_MANIFEST: any[];
};

const serwist = new Serwist({
  precacheEntries: self.__SERWIST_PRECACHE_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache
});

serwist.addEventListeners();
