---
Name: next-project-setup
Description: Instructions for setting up a new Next.js project
---

## Save project plan

1. Save any plan submitted for the project to a markdown file at feature-plans/project-specification.md
2. As you set up the project, be sure to document any changes to the project specification in the file.

## Initialize the project
1. install the following packages:

```bash
yarn add @snaplet/copycat @snaplet/seed @tailwindcss/typography next next-pwa pg react tailwindcss-animate zod resend lucide-react date-fns browser-image-compression @sentry/nextjs next-themes vercel
```

2. Install the following packages:

```bash
yarn add -D @snaplet/copycat @snaplet/seed @types/katex @types/next-pwa @types/node @types/pg eslint eslint-config-next eslint-formatter-table eslint-plugin-import eslint-plugin-prettier eslint-plugin-react eslint-plugin-react-hooks eslint-plugin-simple-import-sort eslint-plugin-sort-imports-es6-autofix postcss prettier tailwindcss typescript @types/zod @types/resend @types/lucide-react @types/date-fns @types/browser-image-compression @types/sentry__nextjs 
```

3. create a new project in supabase :

```bash
supabase init
```

4. install shadcn/ui:

```bash
npx shadcn@latest init

```

5. Add basic shadcn components:

```bash
npx shadcn@latest add button
npx shadcn@latest add card
npx shadcn@latest add input
npx shadcn@latest add label
npx shadcn@latest add textarea
```

6. Review and apply the @supabase-sdk-setup skill to setup the Supabase SDK.

7. Apply the project structure

8. Set up themes

create a file at components/theme-provider.tsx and add the following code:

```ts
"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider } from "next-themes"

export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>
}
```

then add the following to the root layout:

```tsx
import { ThemeProvider } from "@/components/theme-provider"

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <>
      <html lang="en" suppressHydrationWarning>
        <head />
        <body>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            {children}
          </ThemeProvider>
        </body>
      </html>
    </>
  )
}
```

