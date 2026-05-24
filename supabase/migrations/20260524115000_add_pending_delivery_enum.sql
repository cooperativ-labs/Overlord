alter type public.objective_state add value if not exists 'pending_delivery';

comment on type public.objective_state is
  'Objective queue state. pending_delivery means follow-up execution after a prior delivery produced work that needs a redelivery.';
