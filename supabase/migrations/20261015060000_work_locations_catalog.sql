BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

CREATE TABLE public.work_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 160),
  address text NOT NULL CHECK (char_length(btrim(address)) BETWEEN 3 AND 300),
  number text NOT NULL DEFAULT '' CHECK (char_length(number) <= 30),
  neighborhood text NOT NULL DEFAULT '' CHECK (char_length(neighborhood) <= 120),
  city text NOT NULL CHECK (char_length(btrim(city)) BETWEEN 2 AND 120),
  state text NOT NULL CHECK (state ~ '^[A-Z]{2}$'),
  postal_code text NOT NULL DEFAULT '' CHECK (postal_code = '' OR postal_code ~ '^[0-9]{8}$'),
  country_code text NOT NULL DEFAULT 'BR' CHECK (country_code = 'BR'),
  latitude double precision,
  longitude double precision,
  geocoding_status text NOT NULL DEFAULT 'pending'
    CHECK (geocoding_status IN ('pending', 'resolved', 'failed', 'needs_review')),
  coordinate_source text CHECK (coordinate_source IN ('geocoder', 'manual')),
  geocoded_at timestamptz,
  geocoding_attempted_at timestamptz,
  geocoding_error_code text,
  address_version integer NOT NULL DEFAULT 1 CHECK (address_version > 0),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  is_default boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_locations_coordinates_check CHECK (
    (latitude IS NULL AND longitude IS NULL) OR
    (latitude IS NOT NULL AND longitude IS NOT NULL
      AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
  ),
  CONSTRAINT work_locations_resolution_check CHECK (
    (geocoding_status = 'resolved' AND latitude IS NOT NULL AND coordinate_source IS NOT NULL)
    OR (geocoding_status <> 'resolved' AND latitude IS NULL AND longitude IS NULL AND coordinate_source IS NULL)
  ),
  CONSTRAINT work_locations_default_active_check CHECK (NOT is_default OR archived_at IS NULL)
);

CREATE INDEX work_locations_owner_active_idx
  ON public.work_locations(restaurant_id, archived_at, name);
CREATE UNIQUE INDEX work_locations_one_default_idx
  ON public.work_locations(restaurant_id) WHERE is_default AND archived_at IS NULL;

ALTER TABLE public.work_locations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.work_locations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.work_locations TO authenticated;

CREATE POLICY work_locations_select_owner ON public.work_locations
FOR SELECT TO authenticated USING (
  restaurant_id = (SELECT auth.uid())
  AND EXISTS (SELECT 1 FROM public.users WHERE id = (SELECT auth.uid()) AND role = 'restaurant')
);
CREATE POLICY work_locations_select_owner_restrictive ON public.work_locations
AS RESTRICTIVE FOR SELECT TO authenticated USING (
  restaurant_id = (SELECT auth.uid())
  AND EXISTS (SELECT 1 FROM public.users WHERE id = (SELECT auth.uid()) AND role = 'restaurant')
);

-- All catalog writes serialize on the owner, including concurrent default changes.
CREATE FUNCTION public.save_work_location(
  p_name text, p_address text, p_number text, p_neighborhood text,
  p_city text, p_state text, p_postal_code text,
  p_id uuid DEFAULT NULL, p_expected_revision integer DEFAULT NULL
)
RETURNS public.work_locations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  owner_id uuid := auth.uid();
  current_location public.work_locations%ROWTYPE;
  saved public.work_locations%ROWTYPE;
  address_changed boolean;
BEGIN
  PERFORM 1 FROM public.users WHERE id = owner_id AND role = 'restaurant' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Entre na conta do restaurante para gerenciar locais.' USING ERRCODE = '42501';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.work_locations(restaurant_id, name, address, number, neighborhood, city, state, postal_code)
    VALUES (owner_id, btrim(p_name), btrim(p_address), btrim(p_number), btrim(p_neighborhood),
      btrim(p_city), upper(btrim(p_state)), regexp_replace(p_postal_code, '[^0-9]', '', 'g'))
    RETURNING * INTO saved;
    RETURN saved;
  END IF;

  SELECT * INTO current_location FROM public.work_locations WHERE id = p_id AND restaurant_id = owner_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Local não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF p_expected_revision IS DISTINCT FROM current_location.revision THEN
    RAISE EXCEPTION 'O local foi atualizado em outra sessão. Recarregue antes de continuar.' USING ERRCODE = '40001';
  END IF;
  IF current_location.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Restaure o local antes de editar.' USING ERRCODE = '22023';
  END IF;
  address_changed := ROW(current_location.address, current_location.number, current_location.neighborhood,
    current_location.city, current_location.state, current_location.postal_code)
    IS DISTINCT FROM ROW(btrim(p_address), btrim(p_number), btrim(p_neighborhood), btrim(p_city),
      upper(btrim(p_state)), regexp_replace(p_postal_code, '[^0-9]', '', 'g'));

  UPDATE public.work_locations SET
    name = btrim(p_name), address = btrim(p_address), number = btrim(p_number),
    neighborhood = btrim(p_neighborhood), city = btrim(p_city),
    state = upper(btrim(p_state)), postal_code = regexp_replace(p_postal_code, '[^0-9]', '', 'g'),
    latitude = CASE WHEN address_changed THEN NULL ELSE latitude END,
    longitude = CASE WHEN address_changed THEN NULL ELSE longitude END,
    coordinate_source = CASE WHEN address_changed THEN NULL ELSE coordinate_source END,
    geocoding_status = CASE WHEN address_changed THEN 'pending' ELSE geocoding_status END,
    geocoded_at = CASE WHEN address_changed THEN NULL ELSE geocoded_at END,
    geocoding_attempted_at = CASE WHEN address_changed THEN NULL ELSE geocoding_attempted_at END,
    geocoding_error_code = CASE WHEN address_changed THEN NULL ELSE geocoding_error_code END,
    address_version = address_version + CASE WHEN address_changed THEN 1 ELSE 0 END,
    revision = revision + 1, updated_at = now()
  WHERE id = p_id RETURNING * INTO saved;
  RETURN saved;
END;
$function$;

CREATE FUNCTION public.manage_work_location(p_id uuid, p_action text, p_expected_revision integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  owner_id uuid := auth.uid();
  target public.work_locations%ROWTYPE;
BEGIN
  PERFORM 1 FROM public.users WHERE id = owner_id AND role = 'restaurant' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Entre na conta do restaurante para gerenciar locais.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO target FROM public.work_locations WHERE id = p_id AND restaurant_id = owner_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Local não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF p_expected_revision IS DISTINCT FROM target.revision THEN
    RAISE EXCEPTION 'O local foi atualizado em outra sessão. Recarregue antes de continuar.' USING ERRCODE = '40001';
  END IF;

  CASE p_action
    WHEN 'set_default' THEN
      IF target.archived_at IS NOT NULL THEN
        RAISE EXCEPTION 'Restaure o local antes de defini-lo como padrão.' USING ERRCODE = '22023';
      END IF;
      UPDATE public.work_locations SET is_default = false, revision = revision + 1, updated_at = now()
      WHERE restaurant_id = owner_id AND is_default AND id <> p_id;
      UPDATE public.work_locations SET is_default = true, revision = revision + 1, updated_at = now() WHERE id = p_id;
    WHEN 'unset_default' THEN
      UPDATE public.work_locations SET is_default = false, revision = revision + 1, updated_at = now() WHERE id = p_id;
    WHEN 'archive' THEN
      UPDATE public.work_locations SET archived_at = now(), is_default = false,
        revision = revision + 1, updated_at = now() WHERE id = p_id;
    WHEN 'restore' THEN
      UPDATE public.work_locations SET archived_at = NULL, revision = revision + 1, updated_at = now() WHERE id = p_id;
    WHEN 'delete' THEN
      IF target.archived_at IS NULL THEN
        RAISE EXCEPTION 'Arquive o local antes de excluir definitivamente.' USING ERRCODE = '22023';
      END IF;
      DELETE FROM public.work_locations WHERE id = p_id;
    ELSE
      RAISE EXCEPTION 'Ação de local inválida.' USING ERRCODE = '22023';
  END CASE;
END;
$function$;

REVOKE ALL ON FUNCTION public.save_work_location(text,text,text,text,text,text,text,uuid,integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.manage_work_location(uuid,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_work_location(text,text,text,text,text,text,text,uuid,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.manage_work_location(uuid,text,integer) TO authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
