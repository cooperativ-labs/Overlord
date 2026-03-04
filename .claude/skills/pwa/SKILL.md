---
name: pwa
description: Configuring Progressive Web Apps (PWA) with Next.js App Router and Serwist for offline support, push notifications, and home screen installation.
---

# PWA with Next.js App Router

## Instructions

This skill covers everything needed to turn a Next.js App Router project into a fully-featured PWA with offline support (via Serwist), push notifications (via VAPID/web-push), and home screen installation.

---

## 1. Web App Manifest

Create `app/manifest.ts` (Next.js handles routing automatically):

```ts
// app/manifest.ts
import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'My App',
    short_name: 'App',
    description: 'A Progressive Web App built with Next.js',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#000000',
    icons: [
      { src: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png' },
      {
        src: '/icons/icon-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
```

Generate icon sets at https://realfavicongenerator.net/ and place them in `public/icons/`.

---

## 2. Offline Support with Serwist

### Installation

```bash
yarn add @serwist/next
yarn add -D serwist
```

> **Turbopack note:** Serwist does not support Turbopack. Disable it during dev.

### next.config.ts

For ESM (`next.config.mjs`):

```ts
import withSerwistInit from '@serwist/next'

const withSerwist = withSerwistInit({
  swSrc: 'app/sw.ts',
  swDest: 'public/sw.js',
  disable: process.env.NODE_ENV === 'development', // disable during dev to avoid stale cache
})

export default withSerwist({
  // ...your Next.js config
})
```

For CommonJS (`next.config.js`):

```js
module.exports = async () => {
  const withSerwist = (await import('@serwist/next')).default({
    swSrc: 'app/sw.ts',
    swDest: 'public/sw.js',
    disable: process.env.NODE_ENV === 'development',
  })
  return withSerwist({
    // ...your Next.js config
  })
}
```

### Service Worker (`app/sw.ts`)

```ts
import { defaultCache } from '@serwist/next/worker'
import { Serwist } from 'serwist'

declare const self: ServiceWorkerGlobalScope

const serwist = new Serwist({
  precacheEntries: self.__SERWIST_PRECACHE_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache, // optimized for Next.js routes
})

serwist.addEventListeners()
```

`defaultCache` handles static assets, API routes, RSC prefetches, and HTML pages automatically. In dev mode it uses `NetworkOnly` to prevent stale content.

### tsconfig.json additions

```json
{
  "compilerOptions": {
    "lib": ["dom", "dom.iterable", "esnext", "webworker"],
    "types": ["@serwist/next/typings"]
  },
  "exclude": ["public/sw.js", "public/swe-worker*.js"]
}
```

### .gitignore additions

```
public/sw.js
public/sw.js.map
public/swe-worker*.js
```

### Key Serwist config options

| Option | Default | Description |
|--------|---------|-------------|
| `swSrc` | required | Path to your SW source file |
| `swDest` | required | Output path (must be in `public/`) |
| `disable` | `false` | Set to `true` in dev |
| `register` | `true` | Auto-registers the SW |
| `cacheOnNavigation` | `false` | Cache pages during frontend nav |
| `reloadOnOnline` | `false` | Reload page when connection restored |
| `additionalPrecacheEntries` | `[]` | Extra files to precache |
| `globPublicPatterns` | `['**/*']` | Patterns for public dir precaching |

---

## 3. Security Headers

Add to `next.config.ts`:

```ts
const securityHeaders = async () => [
  {
    source: '/(.*)',
    headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    ],
  },
  {
    source: '/sw.js',
    headers: [
      { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
      { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
      { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self'" },
    ],
  },
]
```

---

## 4. Home Screen Installation

Add this component where appropriate (e.g., in a settings page or a banner):

```tsx
// components/InstallPrompt.tsx
'use client'

import { useState, useEffect } from 'react'

export function InstallPrompt() {
  const [isIOS, setIsIOS] = useState(false)
  const [isStandalone, setIsStandalone] = useState(false)
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null)

  useEffect(() => {
    setIsIOS(/iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream)
    setIsStandalone(window.matchMedia('(display-mode: standalone)').matches)

    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  if (isStandalone) return null

  const handleInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt()
      await deferredPrompt.userChoice
      setDeferredPrompt(null)
    }
  }

  return (
    <div>
      {deferredPrompt && (
        <button onClick={handleInstall}>Install App</button>
      )}
      {isIOS && (
        <p>
          To install: tap the Share button ⎋ then "Add to Home Screen" ➕
        </p>
      )}
    </div>
  )
}
```

> **Note:** `beforeinstallprompt` is Chromium-only. iOS requires manual instructions (shown above). Don't rely on it as the only install path.

---

## 5. Push Notifications

### Generate VAPID Keys

```bash
yarn global add web-push
web-push generate-vapid-keys
```

Add to `.env.local`:

```env
NEXT_PUBLIC_VAPID_PUBLIC_KEY=your_public_key_here
VAPID_PRIVATE_KEY=your_private_key_here
VAPID_EMAIL=mailto:your-email@example.com
```

### Install web-push

```bash
yarn add web-push
yarn add -D @types/web-push
```

### Server Actions (`app/actions.ts`)

```ts
'use server'

import webpush, { PushSubscription } from 'web-push'

webpush.setVapidDetails(
  process.env.VAPID_EMAIL!,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
)

export async function subscribeUser(sub: PushSubscription) {
  // Store in database: await db.pushSubscriptions.upsert({ data: sub, where: { endpoint: sub.endpoint } })
  return { success: true }
}

export async function unsubscribeUser(endpoint: string) {
  // Remove from database: await db.pushSubscriptions.delete({ where: { endpoint } })
  return { success: true }
}

export async function sendNotification(endpoint: string, message: string) {
  // Load subscription from database
  // const sub = await db.pushSubscriptions.findUnique({ where: { endpoint } })
  try {
    await webpush.sendNotification(
      sub,
      JSON.stringify({ title: 'Notification', body: message, icon: '/icons/icon-192x192.png' })
    )
    return { success: true }
  } catch (error) {
    console.error('Push notification error:', error)
    return { success: false }
  }
}
```

### Push Manager Component

```tsx
// components/PushNotificationManager.tsx
'use client'

import { useState, useEffect } from 'react'
import { subscribeUser, unsubscribeUser } from '@/app/actions'

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  return new Uint8Array([...rawData].map((c) => c.charCodeAt(0)))
}

export function PushNotificationManager() {
  const [isSupported, setIsSupported] = useState(false)
  const [subscription, setSubscription] = useState<PushSubscription | null>(null)

  useEffect(() => {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      setIsSupported(true)
      navigator.serviceWorker
        .register('/sw.js', { scope: '/', updateViaCache: 'none' })
        .then((reg) => reg.pushManager.getSubscription())
        .then(setSubscription)
    }
  }, [])

  const subscribe = async () => {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!),
    })
    setSubscription(sub)
    await subscribeUser(JSON.parse(JSON.stringify(sub)))
  }

  const unsubscribe = async () => {
    await subscription?.unsubscribe()
    await unsubscribeUser(subscription!.endpoint)
    setSubscription(null)
  }

  if (!isSupported) return null

  return (
    <div>
      {subscription ? (
        <button onClick={unsubscribe}>Disable Notifications</button>
      ) : (
        <button onClick={subscribe}>Enable Notifications</button>
      )}
    </div>
  )
}
```

### Service Worker Push Handler

Add to `app/sw.ts` (alongside Serwist setup):

```ts
// Push notification handling — add before serwist.addEventListeners()
self.addEventListener('push', (event: PushEvent) => {
  if (!event.data) return
  const data = event.data.json()
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || '/icons/icon-192x192.png',
      badge: '/icons/badge-72x72.png',
      vibrate: [100, 50, 100],
      data: { url: data.url || '/' },
    })
  )
})

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close()
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      const url = event.notification.data?.url || '/'
      const existingClient = clientList.find((c) => c.url === url && 'focus' in c)
      return existingClient ? existingClient.focus() : clients.openWindow(url)
    })
  )
})
```

---

## 6. Testing Locally

```bash
# Run with HTTPS (required for SW + Push APIs)
next dev --experimental-https
```

Checklist:
- [ ] Browser has notifications enabled (not blocked globally)
- [ ] Service worker appears in DevTools → Application → Service Workers
- [ ] Manifest validated in DevTools → Application → Manifest
- [ ] Lighthouse PWA audit passes
- [ ] Test on iOS (Safari) and Chrome separately — behavior differs

---

## 7. Browser Support Notes

| Feature | Chrome | Firefox | Safari iOS |
|---------|--------|---------|------------|
| Service Worker | ✅ | ✅ | ✅ 11.1+ |
| Push Notifications | ✅ | ✅ | ✅ 16.4+ (installed only) |
| `beforeinstallprompt` | ✅ | ❌ | ❌ |
| Install to home screen | ✅ auto | manual | manual share |

---

## Examples

### Minimal setup (manifest + Serwist only, no push)

1. Create `app/manifest.ts`
2. Install `@serwist/next` and `serwist`
3. Wrap `next.config.ts` with `withSerwist`
4. Create `app/sw.ts` with `defaultCache`
5. Update `tsconfig.json` and `.gitignore`

### Full PWA with push notifications

Follow all 7 steps above end-to-end. Store push subscriptions in the database (Supabase) keyed by `endpoint`. Trigger sends from server actions or Supabase Edge Functions.

<!-- version: 1.0.0 -->
