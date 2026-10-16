-- Read-only checks. Run in the SQL Editor; do not share endpoint or key values.
SELECT id, job_id, sender_id, created_at, read_at
FROM public.messages ORDER BY created_at DESC LIMIT 20;

SELECT id, user_id, category, title, read, url, message_id, created_at
FROM public.notifications ORDER BY created_at DESC LIMIT 30;

SELECT id, user_id, created_at, updated_at,
  (length(p256dh) > 0) AS has_encryption_key,
  (length(auth_secret) > 0) AS has_auth_secret
FROM public.push_subscriptions ORDER BY updated_at DESC LIMIT 30;

SELECT notification_id, subscription_id, status, status_code, updated_at
FROM public.push_deliveries ORDER BY updated_at DESC LIMIT 50;

SELECT n.id, n.user_id, n.category, n.read,
  (SELECT count(*) FROM public.push_subscriptions AS s WHERE s.user_id = n.user_id) AS devices,
  (SELECT count(*) FROM public.push_deliveries AS d WHERE d.notification_id = n.id) AS attempts
FROM public.notifications AS n ORDER BY n.created_at DESC LIMIT 30;

SELECT t.tgrelid::regclass AS table_name, t.tgname, t.tgenabled, p.proname
FROM pg_catalog.pg_trigger AS t JOIN pg_catalog.pg_proc AS p ON p.oid = t.tgfoid
WHERE t.tgrelid IN ('public.messages'::regclass, 'public.notifications'::regclass)
  AND NOT t.tgisinternal;

SELECT user_id, messages_enabled, applications_enabled, reviews_enabled, operations_enabled, events_enabled
FROM public.notification_preferences;

SELECT schemaname, tablename FROM pg_catalog.pg_publication_tables
WHERE pubname = 'supabase_realtime' AND tablename IN ('messages', 'notifications');

SELECT schemaname, tablename, policyname, roles, cmd
FROM pg_catalog.pg_policies
WHERE schemaname = 'public' AND tablename IN
  ('users', 'worker_profiles', 'restaurant_profiles', 'jobs', 'applications', 'messages',
   'reviews', 'notifications', 'push_subscriptions', 'notification_preferences', 'privacy_preferences');