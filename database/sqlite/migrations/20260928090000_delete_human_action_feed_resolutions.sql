-- Remove the Human Actions feed (coo:1098, contract v150).
--
-- The cross-workspace Human Actions rail on the Feed page is gone, and with it
-- the only surface that let an operator mark a reported human action done or
-- dismissed. Those resolutions are dead data: delete them. Deferred-work
-- resolutions (action_id `deferred-work-*`) still back the delivery card's
-- Create mission / Add objective / Dismiss state and are kept.

PRAGMA foreign_keys = ON;

DELETE FROM human_action_resolutions WHERE action_id NOT LIKE 'deferred-work-%';
