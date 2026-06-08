-- Per-objective override of the per-target agent launch config (pre-command +
-- flags). The mobile AgentLaunchFooter writes this so a user can tailor the
-- launch for a single objective without mutating the execution target's shared
-- CliPage / Execution Targets config.
--
-- Semantics:
--   NULL                      -> no override; inherit the execution target's
--                                per-agent launch config at claim time.
--   { "flags": [...],         -> override is active. Empty flags / absent
--     "preCommand": "..."? }     preCommand mean the user explicitly wants NO
--                                flags / NO pre-command for this objective, and
--                                the target config is NOT consulted.
alter table public.objectives
  add column if not exists launch_config jsonb;

comment on column public.objectives.launch_config is
  'Per-objective override of the agent launch config (pre-command + flags). NULL inherits the execution target config; a non-null { flags, preCommand } overrides it, where empty values mean the user wants none for this objective.';
