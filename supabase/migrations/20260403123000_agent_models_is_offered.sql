alter table agent_models
  add column is_offered boolean not null default true;

update agent_models
set is_offered = true
where is_offered is distinct from true;
