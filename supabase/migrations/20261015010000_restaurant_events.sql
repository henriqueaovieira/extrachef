CREATE TABLE IF NOT EXISTS public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  event_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  expected_people integer NOT NULL,
  status text NOT NULL DEFAULT 'scheduled',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT events_title_length_check
    CHECK (char_length(btrim(title)) BETWEEN 2 AND 160),
  CONSTRAINT events_description_length_check
    CHECK (char_length(description) <= 4000),
  CONSTRAINT events_expected_people_check
    CHECK (expected_people BETWEEN 1 AND 100000),
  CONSTRAINT events_time_range_check
    CHECK (start_time < end_time),
  CONSTRAINT events_status_check
    CHECK (status IN ('scheduled', 'cancelled', 'completed'))
);

CREATE INDEX IF NOT EXISTS events_restaurant_date_idx
  ON public.events (restaurant_id, event_date, start_time);

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.events TO authenticated;

DROP POLICY IF EXISTS events_select_own_restaurant ON public.events;
CREATE POLICY events_select_own_restaurant
ON public.events
FOR SELECT TO authenticated
USING (
  restaurant_id = (SELECT auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.users AS users
    WHERE users.id = (SELECT auth.uid()) AND users.role = 'restaurant'
  )
);

DROP POLICY IF EXISTS events_select_own_restaurant_restrictive ON public.events;
CREATE POLICY events_select_own_restaurant_restrictive
ON public.events AS RESTRICTIVE
FOR SELECT TO authenticated
USING (
  restaurant_id = (SELECT auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.users AS users
    WHERE users.id = (SELECT auth.uid()) AND users.role = 'restaurant'
  )
);

DROP POLICY IF EXISTS events_insert_own_restaurant ON public.events;
CREATE POLICY events_insert_own_restaurant
ON public.events
FOR INSERT TO authenticated
WITH CHECK (
  restaurant_id = (SELECT auth.uid())
  AND status = 'scheduled'
  AND EXISTS (
    SELECT 1 FROM public.users AS users
    WHERE users.id = (SELECT auth.uid()) AND users.role = 'restaurant'
  )
);

DROP POLICY IF EXISTS events_insert_own_restaurant_restrictive ON public.events;
CREATE POLICY events_insert_own_restaurant_restrictive
ON public.events AS RESTRICTIVE
FOR INSERT TO authenticated
WITH CHECK (
  restaurant_id = (SELECT auth.uid())
  AND status = 'scheduled'
  AND EXISTS (
    SELECT 1 FROM public.users AS users
    WHERE users.id = (SELECT auth.uid()) AND users.role = 'restaurant'
  )
);

DROP POLICY IF EXISTS events_update_own_restaurant ON public.events;
CREATE POLICY events_update_own_restaurant
ON public.events
FOR UPDATE TO authenticated
USING (
  restaurant_id = (SELECT auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.users AS users
    WHERE users.id = (SELECT auth.uid()) AND users.role = 'restaurant'
  )
)
WITH CHECK (
  restaurant_id = (SELECT auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.users AS users
    WHERE users.id = (SELECT auth.uid()) AND users.role = 'restaurant'
  )
);

DROP POLICY IF EXISTS events_update_own_restaurant_restrictive ON public.events;
CREATE POLICY events_update_own_restaurant_restrictive
ON public.events AS RESTRICTIVE
FOR UPDATE TO authenticated
USING (
  restaurant_id = (SELECT auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.users AS users
    WHERE users.id = (SELECT auth.uid()) AND users.role = 'restaurant'
  )
)
WITH CHECK (
  restaurant_id = (SELECT auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.users AS users
    WHERE users.id = (SELECT auth.uid()) AND users.role = 'restaurant'
  )
);

DROP POLICY IF EXISTS events_delete_own_restaurant ON public.events;
CREATE POLICY events_delete_own_restaurant
ON public.events
FOR DELETE TO authenticated
USING (
  restaurant_id = (SELECT auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.users AS users
    WHERE users.id = (SELECT auth.uid()) AND users.role = 'restaurant'
  )
);

DROP POLICY IF EXISTS events_delete_own_restaurant_restrictive ON public.events;
CREATE POLICY events_delete_own_restaurant_restrictive
ON public.events AS RESTRICTIVE
FOR DELETE TO authenticated
USING (
  restaurant_id = (SELECT auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.users AS users
    WHERE users.id = (SELECT auth.uid()) AND users.role = 'restaurant'
  )
);

CREATE OR REPLACE FUNCTION public.set_event_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS events_set_updated_at ON public.events;
CREATE TRIGGER events_set_updated_at
BEFORE UPDATE ON public.events
FOR EACH ROW
EXECUTE FUNCTION public.set_event_updated_at();
