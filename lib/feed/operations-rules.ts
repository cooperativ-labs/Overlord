import type { Deployable, RepoOperationsProfile } from '@/lib/repo-profile/types';

export type CandidateActionCategory =
  | 'redeploy'
  | 'migration'
  | 'codegen'
  | 'seed'
  | 'install'
  | 'test'
  | 'config'
  | 'rebuild';

export type CandidateAction = {
  id: string;
  text: string;
  reason: string;
  confidence: 'high' | 'medium';
  category: CandidateActionCategory;
  supersedes?: string[];
};

type RuleContext = {
  profile: RepoOperationsProfile;
  changedPaths: string[];
  changedSet: Set<string>;
};

type Rule = {
  id: string;
  /** Returns at most one CandidateAction; null if rule does not fire. */
  evaluate: (ctx: RuleContext) => CandidateAction | null;
  /** Default-on; tests rule is opt-in. */
  enabled?: (profile: RepoOperationsProfile) => boolean;
};

function pathStartsWithAny(path: string, prefixes: string[]): boolean {
  for (const p of prefixes) {
    if (!p) continue;
    if (path === p || path.startsWith(`${p}/`)) return true;
  }
  return false;
}

function changesUnder(ctx: RuleContext, prefix: string): string[] {
  if (!prefix) return [];
  return ctx.changedPaths.filter(p => p === prefix || p.startsWith(`${prefix}/`));
}

function deployableHits(ctx: RuleContext, dep: Deployable): string[] {
  if (dep.path === '') return ctx.changedPaths.slice();
  return changesUnder(ctx, dep.path);
}

function pkgRoot(filePath: string): string {
  return filePath === 'package.json' ? '' : filePath.replace(/\/package\.json$/, '');
}

const NATIVE_FILE_RE = /^(?:|.+\/)(ios|android)\//;

const rules: Rule[] = [
  {
    id: 'supabase.run-migrations',
    evaluate: ctx => {
      const m = ctx.profile.migrations;
      if (!m?.migrations_dir) return null;
      const hits = changesUnder(ctx, m.migrations_dir);
      if (hits.length === 0) return null;
      return {
        id: 'supabase.run-migrations',
        text: 'Run new database migrations against staging/production',
        reason: `${hits.length} file(s) changed under ${m.migrations_dir}`,
        confidence: 'high',
        category: 'migration'
      };
    }
  },
  {
    id: 'supabase.regenerate-types',
    evaluate: ctx => {
      const m = ctx.profile.migrations;
      if (!m?.migrations_dir || !m.types_output) return null;
      const migrated = changesUnder(ctx, m.migrations_dir);
      if (migrated.length === 0) return null;
      const cmd = m.generate_command
        ? `\`yarn ${m.generate_command}\``
        : 'the type-generation script';
      return {
        id: 'supabase.regenerate-types',
        text: `Run ${cmd} to regenerate \`${m.types_output}\``,
        reason: `migrations changed and types_output is set to ${m.types_output}`,
        confidence: 'high',
        category: 'codegen'
      };
    }
  },
  {
    id: 'supabase.seed-sync',
    evaluate: ctx => {
      const m = ctx.profile.migrations;
      if (!m) return null;
      const seedHit = m.seed_files.find(f => ctx.changedSet.has(f));
      if (!seedHit) return null;
      const cmd = m.seed_sync_command
        ? `Run \`yarn ${m.seed_sync_command}\` to sync seed data`
        : 'Sync seed data to your local database';
      return {
        id: 'supabase.seed-sync',
        text: cmd,
        reason: `seed file ${seedHit} changed`,
        confidence: 'high',
        category: 'seed'
      };
    }
  },
  {
    id: 'supabase.deploy-edge-fn',
    evaluate: ctx => {
      const fns = ctx.profile.deployables.filter(d => d.kind === 'edge-function');
      const touched = fns.filter(f => deployableHits(ctx, f).length > 0);
      if (touched.length === 0) return null;
      const names = touched.map(f => `\`${f.name}\``).join(', ');
      const cmd = touched.map(f => `supabase functions deploy ${f.name}`).join(' && ');
      return {
        id: 'supabase.deploy-edge-fn',
        text: `Deploy edge function${touched.length > 1 ? 's' : ''} ${names}: \`${cmd}\``,
        reason: `${touched.length} edge function(s) changed`,
        confidence: 'high',
        category: 'redeploy',
        supersedes: ['vercel.redeploy']
      };
    }
  },
  {
    id: 'vercel.redeploy',
    evaluate: ctx => {
      const apps = ctx.profile.deployables.filter(
        d => d.kind === 'nextjs-app' && d.deploy_target === 'vercel'
      );
      const touched = apps.filter(a => deployableHits(ctx, a).length > 0);
      if (touched.length === 0) return null;
      const names = touched.map(a => `\`${a.name}\``).join(', ');
      return {
        id: 'vercel.redeploy',
        text: `Redeploy ${names} to Vercel (or wait for auto-deploy on push)`,
        reason: `${touched.length} Next.js app(s) changed`,
        confidence: 'medium',
        category: 'redeploy'
      };
    }
  },
  {
    id: 'expo.rebuild-dev-client',
    evaluate: ctx => {
      const apps = ctx.profile.deployables.filter(d => d.kind === 'expo-app');
      for (const app of apps) {
        const hits = deployableHits(ctx, app);
        const native = hits.some(p => NATIVE_FILE_RE.test(p));
        const config = hits.some(p => /(^|\/)(app\.config\.[mc]?[jt]s|app\.json)$/.test(p));
        if (native || config) {
          return {
            id: 'expo.rebuild-dev-client',
            text: `Rebuild Expo dev client for \`${app.name}\` (native code or config changed)`,
            reason: native ? 'native ios/android files changed' : 'app.config / app.json changed',
            confidence: 'high',
            category: 'rebuild'
          };
        }
      }
      return null;
    }
  },
  {
    id: 'pkg.reinstall',
    evaluate: ctx => {
      const manifestHits = ctx.profile.manifests.filter(m => ctx.changedSet.has(m.path));
      if (manifestHits.length === 0) return null;
      const items = manifestHits.map(m => {
        const ws = pkgRoot(m.path) || 'repo root';
        return `\`${ws}\``;
      });
      return {
        id: 'pkg.reinstall',
        text: `Run \`yarn install\` (manifest changed in ${items.join(', ')})`,
        reason: `${manifestHits.length} package.json file(s) changed`,
        confidence: 'high',
        category: 'install'
      };
    }
  },
  {
    id: 'pkg.lockfile-conflict',
    evaluate: ctx => {
      const lockHits = ctx.profile.manifests
        .filter(m => m.lockfile && ctx.changedSet.has(m.lockfile))
        .filter(m => !ctx.changedSet.has(m.path));
      if (lockHits.length === 0) return null;
      return {
        id: 'pkg.lockfile-conflict',
        text: 'Lockfile changed without a manifest change — verify this was intentional',
        reason: lockHits
          .map(m => m.lockfile)
          .filter(Boolean)
          .join(', '),
        confidence: 'medium',
        category: 'install'
      };
    }
  },
  {
    id: 'env.new-vars',
    evaluate: ctx => {
      const hits = ctx.profile.signals.env_example_paths.filter(p => ctx.changedSet.has(p));
      if (hits.length === 0) return null;
      return {
        id: 'env.new-vars',
        text: 'Add the new env vars to your local `.env` and to the deployed environment',
        reason: hits.join(', '),
        confidence: 'high',
        category: 'config'
      };
    }
  },
  {
    id: 'codegen.regenerate',
    evaluate: ctx => {
      for (const step of ctx.profile.codegen) {
        const matched = ctx.changedPaths.some(p =>
          step.triggers.some(trigger => matchesTrigger(p, trigger))
        );
        if (matched) {
          const cmd = step.command ? `\`yarn ${step.command}\`` : 'the codegen script';
          return {
            id: `codegen.regenerate.${step.name}`,
            text: `Run ${cmd} to regenerate ${step.name} outputs`,
            reason: `source files for ${step.name} codegen changed`,
            confidence: 'high',
            category: 'codegen'
          };
        }
      }
      return null;
    }
  },
  {
    id: 'ci.workflow-changed',
    evaluate: ctx => {
      const hits = ctx.changedPaths.filter(p => /^\.github\/workflows\//.test(p));
      if (hits.length === 0) return null;
      return {
        id: 'ci.workflow-changed',
        text: 'Watch the next CI workflow run after pushing — workflow definition changed',
        reason: hits.join(', '),
        confidence: 'medium',
        category: 'config'
      };
    }
  },
  {
    id: 'docker.rebuild',
    evaluate: ctx => {
      const hits = ctx.changedPaths.filter(
        p => /(^|\/)Dockerfile$/.test(p) || /(^|\/)docker-compose\.ya?ml$/.test(p)
      );
      if (hits.length === 0) return null;
      return {
        id: 'docker.rebuild',
        text: 'Rebuild Docker images',
        reason: hits.join(', '),
        confidence: 'high',
        category: 'rebuild'
      };
    }
  }
];

function matchesTrigger(filePath: string, trigger: string): boolean {
  if (trigger === filePath) return true;
  if (trigger.endsWith('/**')) {
    const base = trigger.slice(0, -3);
    return filePath.startsWith(`${base}/`);
  }
  if (trigger.startsWith('**/*.')) {
    const ext = trigger.slice(4);
    return filePath.endsWith(ext);
  }
  if (trigger.includes('*')) {
    // Minimal glob: support trailing extension wildcards only.
    const ext = trigger.slice(trigger.lastIndexOf('.'));
    return filePath.endsWith(ext);
  }
  return filePath === trigger;
}

export type DeriveOptions = {
  /** Allow the test-runner rule (off by default per system instruction). */
  allowTestSuggestions?: boolean;
};

export function deriveCandidateActions(
  profile: RepoOperationsProfile | null,
  changedPaths: string[],
  options: DeriveOptions = {}
): CandidateAction[] {
  if (!profile || changedPaths.length === 0) return [];

  const ctx: RuleContext = {
    profile,
    changedPaths,
    changedSet: new Set(changedPaths)
  };

  const fired: CandidateAction[] = [];
  const supersededIds = new Set<string>();

  for (const rule of rules) {
    if (rule.enabled && !rule.enabled(profile)) continue;
    if (!options.allowTestSuggestions && rule.id === 'tests.run-targeted') continue;
    const action = rule.evaluate(ctx);
    if (!action) continue;
    fired.push(action);
    if (action.supersedes) {
      for (const sup of action.supersedes) supersededIds.add(sup);
    }
  }

  return fired.filter(a => !supersededIds.has(a.id));
}

export function formatCandidatesForPrompt(candidates: CandidateAction[]): string {
  if (candidates.length === 0) return '';
  const lines = candidates.map(c => `- [${c.id}] ${c.text}`);
  return `CANDIDATE FOLLOW-UP ACTIONS (deterministically derived from repo structure — place relevant ones on the appropriate objective's action_required, rephrase if needed, drop any that don't apply, and add others only if genuinely missing):\n${lines.join('\n')}`;
}
