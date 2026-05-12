/// <reference lib="deno.ns" />
/**
 * Deterministic rule engine for follow-up action candidates.
 *
 * Mirrors `lib/feed/operations-rules.ts` for use inside the Deno edge function
 * runtime. Keep the two files in sync — they share a schema (RepoOperationsProfile)
 * but cannot share imports across the Node ↔ Deno boundary.
 */

export type DeployableKind =
  | 'nextjs-app'
  | 'expo-app'
  | 'electron-app'
  | 'edge-function'
  | 'vercel-project'
  | 'cloudflare-worker'
  | 'static-site'
  | 'cli'
  | 'library';

export type Deployable = {
  kind: DeployableKind;
  path: string;
  name: string;
  deploy_target?: string;
};

export type RepoOperationsProfile = {
  schema_version: number;
  workspaces: Array<{ path: string; name: string; manager: string | null; has_lockfile: boolean }>;
  deployables: Deployable[];
  migrations: {
    system: string | null;
    migrations_dir: string | null;
    types_output: string | null;
    seed_files: string[];
    generate_command: string | null;
    seed_sync_command: string | null;
  } | null;
  codegen: Array<{ name: string; triggers: string[]; outputs: string[]; command: string | null }>;
  tests: {
    runner: string | null;
    config_files: string[];
    test_dirs: string[];
    script: string | null;
  } | null;
  manifests: Array<{ path: string; lockfile: string | null }>;
  scripts_by_workspace: Record<string, Record<string, string>>;
  signals: {
    has_dockerfile: boolean;
    has_docker_compose: boolean;
    has_github_actions: boolean;
    has_eas_json: boolean;
    has_app_store_config: boolean;
    has_env_example: boolean;
    env_example_paths: string[];
  };
};

export type CandidateAction = {
  id: string;
  text: string;
  reason: string;
  confidence: 'high' | 'medium';
  category: string;
  supersedes?: string[];
};

type RuleContext = {
  profile: RepoOperationsProfile;
  changedPaths: string[];
  changedSet: Set<string>;
};

type Rule = { id: string; evaluate: (ctx: RuleContext) => CandidateAction | null };

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
    const ext = trigger.slice(trigger.lastIndexOf('.'));
    return filePath.endsWith(ext);
  }
  return filePath === trigger;
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
      if (changesUnder(ctx, m.migrations_dir).length === 0) return null;
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
      const text = m.seed_sync_command
        ? `Run \`yarn ${m.seed_sync_command}\` to sync seed data`
        : 'Sync seed data to your local database';
      return {
        id: 'supabase.seed-sync',
        text,
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
            reason: native ? 'native ios/android files changed' : 'app config changed',
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
      const hits = ctx.profile.manifests.filter(m => ctx.changedSet.has(m.path));
      if (hits.length === 0) return null;
      const items = hits.map(m => `\`${pkgRoot(m.path) || 'repo root'}\``);
      return {
        id: 'pkg.reinstall',
        text: `Run \`yarn install\` (manifest changed in ${items.join(', ')})`,
        reason: `${hits.length} package.json file(s) changed`,
        confidence: 'high',
        category: 'install'
      };
    }
  },
  {
    id: 'pkg.lockfile-conflict',
    evaluate: ctx => {
      const hits = ctx.profile.manifests
        .filter(m => m.lockfile && ctx.changedSet.has(m.lockfile))
        .filter(m => !ctx.changedSet.has(m.path));
      if (hits.length === 0) return null;
      return {
        id: 'pkg.lockfile-conflict',
        text: 'Lockfile changed without a manifest change — verify this was intentional',
        reason: hits
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
        const matched = ctx.changedPaths.some(p => step.triggers.some(t => matchesTrigger(p, t)));
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

export function deriveCandidateActions(
  profile: RepoOperationsProfile | null,
  changedPaths: string[]
): CandidateAction[] {
  if (!profile || changedPaths.length === 0) return [];

  const ctx: RuleContext = {
    profile,
    changedPaths,
    changedSet: new Set(changedPaths)
  };

  const fired: CandidateAction[] = [];
  const superseded = new Set<string>();
  for (const rule of rules) {
    const action = rule.evaluate(ctx);
    if (!action) continue;
    fired.push(action);
    if (action.supersedes) for (const s of action.supersedes) superseded.add(s);
  }
  return fired.filter(a => !superseded.has(a.id));
}

export function formatCandidatesForPrompt(candidates: CandidateAction[]): string {
  if (candidates.length === 0) return '';
  const lines = candidates.map(c => `- [${c.id}] ${c.text}`);
  return `CANDIDATE FOLLOW-UP ACTIONS (deterministically derived from repo structure — place relevant ones on the appropriate objective's action_required, rephrase if needed, drop any that don't apply, and add others only if genuinely missing):\n${lines.join('\n')}`;
}
