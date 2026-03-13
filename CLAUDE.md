<!-- overskill-start -->
## Overskill Skills

This project uses Overskill to manage reusable AI skills.

Before starting any task, read `.claude/skills/SKILLS_INDEX.md` to discover available skills. When a skill is relevant to your current task, read its full SKILL.md file and follow its instructions.

To manage skills, use the `skill` CLI command (run `skill --help` for usage).
<!-- overskill-end -->



## Supabase local APIs

- Project URL: http://127.0.0.1:54321
- REST: http://127.0.0.1:54321/rest/v1
- GraphQL: http://127.0.0.1:54321/graphql/v1
- Edge Functions: http://127.0.0.1:54321/functions/v1
- Mailpit: http://127.0.0.1:54324
- Storage: http://127.0.0.1:54321/storage/v1/s3

## Deployment

- Primary deployment platform: Vercel
- Database hosted on Supabase
- Edge functions deployed to Supabase
- Sentry for error tracking and monitoring


## Authentication

- Supabase Auth for user authentication
- Email confirmation flow
- Onboarding flow for new users

## Common Tasks

### Adding a New Feature

1. Create necessary database tables/functions in Supabase with appropriate RLS policies
2. Run migrations and regenerate types with `yarn generate`
3. Create server actions in `lib/actions/`
4. Build UI components in `components/`
5. Create pages in `app/[organizationId]/`
6. Add tests in `tests/`

### Updating Database Schema

1. Create migration in `supabase/migrations/` (always with timestamp prefix)
2. Test locally with `yarn start` and `supabase db reset`
3. Generate types with `yarn generate`
4. run `yarn seed:sync` to sync the seed data schema
5. Update relevant server actions and components

### Adding a UI Component

1. Use shadcn CLI: `npx shadcn@latest add <component>`
2. Components are added to `components/ui/`
3. Customize as needed while maintaining accessibility

## Troubleshooting

### Type Generation Issues

If Supabase types are out of sync:

```bash
yarn generate  # Regenerate from local Supabase
```

### Build Issues

Clear Next.js cache:

```bash
rm -rf .next
yarn build-dev
```

## Notes for AI Assistants

- Always check `types/database.types.ts` for the latest schema
- Use server actions for database mutations
- Use Supabase Edge Functions for any webhooks or background tasks
- Follow Next.js App Router patterns (Server Components by default)
- Maintain type safety throughout the codebase
- Use Supabase RLS policies for authorization
- Test multi-tenancy scenarios when modifying organization-scoped features
- Handle multi-tenancy via `organization_id`
- Consider mobile responsiveness (PWA support enabled)
- Handle error cases and report to Sentry
- Use proper loading states and error boundaries
- Use Supabase client with TypeScript types
- Implement row-level security (RLS) policies
- Use the `ai/feature-plans` directory for AI-generated feature plans