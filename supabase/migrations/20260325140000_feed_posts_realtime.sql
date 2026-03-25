-- Enable Supabase Realtime for feed_posts so the feed UI can subscribe
-- to INSERT events and display new posts without a full page reload.
ALTER PUBLICATION supabase_realtime ADD TABLE public.feed_posts;
