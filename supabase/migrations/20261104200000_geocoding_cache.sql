-- Apply manually after reviewing the catalog schema. No existing operations are updated.
-- Reuse 20261104040000_reconcile_geocoded_locations.sql to restore the official RPC first.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

CREATE TABLE public.geocoding_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  operation text NOT NULL CHECK (operation IN ('geocode', 'reverse')),
  address_hash text NOT NULL CHECK (address_hash ~ '^[0-9a-f]{64}$'),
  normalized_address jsonb NOT NULL CHECK (jsonb_typeof(normalized_address) = 'object'),
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  result_address jsonb NOT NULL CHECK (jsonb_typeof(result_address) = 'object'),
  provider text NOT NULL,
  provider_namespace text NOT NULL,
  provider_response_hash text NOT NULL CHECK (provider_response_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE(restaurant_id, operation, provider_namespace, address_hash)
);
CREATE INDEX geocoding_cache_expiry_idx ON public.geocoding_cache(expires_at);
CREATE INDEX geocoding_cache_attestation_idx ON public.geocoding_cache(restaurant_id, latitude, longitude)
  WHERE operation = 'geocode';
ALTER TABLE public.geocoding_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.geocoding_cache FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.geocoding_cache TO service_role;

CREATE TABLE public.geocoding_requests (
  namespace text PRIMARY KEY,
  token uuid,
  owner_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  lease_until timestamptz NOT NULL DEFAULT '-infinity',
  available_at timestamptz NOT NULL DEFAULT '-infinity'
);
ALTER TABLE public.geocoding_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.geocoding_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.geocoding_requests TO service_role;

CREATE FUNCTION public.acquire_geocoding_request(p_namespace text, p_owner uuid, p_token uuid, p_seconds integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE acquired boolean := false; owner_namespace text := p_namespace||':'||p_owner::text;
BEGIN
  IF p_namespace IS NULL OR length(p_namespace) <> 64 OR p_token IS NULL
    OR p_seconds IS NULL OR p_seconds NOT BETWEEN 11 AND 40
    OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_owner AND role='restaurant' AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Invalid geocoding request reservation.' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.geocoding_requests(namespace) VALUES(p_namespace) ON CONFLICT DO NOTHING;
  PERFORM 1 FROM public.geocoding_requests WHERE namespace=p_namespace FOR UPDATE;
  INSERT INTO public.geocoding_requests(namespace,owner_id) VALUES(owner_namespace,p_owner) ON CONFLICT DO NOTHING;
  IF EXISTS(SELECT 1 FROM public.geocoding_requests WHERE namespace=owner_namespace AND available_at>clock_timestamp()) THEN
    RETURN false;
  END IF;
  UPDATE public.geocoding_requests
    SET token=p_token, owner_id=p_owner, lease_until=clock_timestamp()+make_interval(secs=>p_seconds)
    WHERE namespace=p_namespace AND lease_until<=clock_timestamp() AND available_at<=clock_timestamp()
    RETURNING true INTO acquired;
  IF acquired THEN
    UPDATE public.geocoding_requests SET available_at=clock_timestamp()+interval '10 seconds'
      WHERE namespace=owner_namespace;
  END IF;
  RETURN COALESCE(acquired,false);
END;
$fn$;

CREATE FUNCTION public.release_geocoding_request(p_namespace text, p_token uuid, p_cooldown integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  IF p_cooldown IS NULL OR p_cooldown NOT BETWEEN 1 AND 3600 THEN
    RAISE EXCEPTION 'Invalid geocoding cooldown.' USING ERRCODE='22023';
  END IF;
  UPDATE public.geocoding_requests SET token=NULL, owner_id=NULL, lease_until='-infinity',
    available_at=clock_timestamp()+make_interval(secs=>p_cooldown)
    WHERE namespace=p_namespace AND token=p_token;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Geocoding reservation expired or replaced.' USING ERRCODE='40001';
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.acquire_geocoding_request(text,uuid,uuid,integer),
  public.release_geocoding_request(text,uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_geocoding_request(text,uuid,uuid,integer),
  public.release_geocoding_request(text,uuid,integer) TO service_role;

CREATE FUNCTION public.normalize_geocoding_field(p_value text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $fn$
  SELECT lower(regexp_replace(btrim(p_value), '\s+', ' ', 'g'));
$fn$;
REVOKE ALL ON FUNCTION public.normalize_geocoding_field(text) FROM PUBLIC, anon, authenticated;

-- Keep the existing RPC/signature; require a server-written resolution when it sets coordinates.
CREATE FUNCTION public.attest_geocoded_work_location()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  IF NEW.geocoding_status='resolved' AND (
    TG_OP='INSERT' OR ROW(NEW.latitude,NEW.longitude,NEW.address,NEW.number,NEW.neighborhood,NEW.city,NEW.state,NEW.postal_code)
      IS DISTINCT FROM ROW(OLD.latitude,OLD.longitude,OLD.address,OLD.number,OLD.neighborhood,OLD.city,OLD.state,OLD.postal_code)
    OR OLD.geocoding_status IS DISTINCT FROM 'resolved'
  ) THEN
    IF NOT EXISTS(SELECT 1 FROM public.geocoding_cache c
      WHERE c.restaurant_id=NEW.restaurant_id AND c.operation='geocode'
        AND c.latitude=NEW.latitude AND c.longitude=NEW.longitude AND c.expires_at>clock_timestamp()
        AND c.normalized_address=jsonb_build_object(
          'address',public.normalize_geocoding_field(NEW.address),
          'number',public.normalize_geocoding_field(NEW.number),
          'neighborhood',public.normalize_geocoding_field(NEW.neighborhood),
          'city',public.normalize_geocoding_field(NEW.city),
          'state',public.normalize_geocoding_field(NEW.state),
          'postal_code',regexp_replace(NEW.postal_code,'[^0-9]','','g'),'country','br')) THEN
      RAISE EXCEPTION 'Consulte o endereço pelo serviço de localização antes de salvar as coordenadas.'
        USING ERRCODE='22023';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.attest_geocoded_work_location() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER work_locations_attest_geocoding BEFORE INSERT OR UPDATE ON public.work_locations
  FOR EACH ROW EXECUTE FUNCTION public.attest_geocoded_work_location();

COMMIT;
NOTIFY pgrst, 'reload schema';
