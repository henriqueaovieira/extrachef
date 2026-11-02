BEGIN;
SET LOCAL lock_timeout = '5s';

DROP FUNCTION public.issue_operational_code(uuid,text);

CREATE FUNCTION public.issue_operational_code(
  p_job_id uuid,
  p_stage text,
  p_latitude double precision DEFAULT NULL,
  p_longitude double precision DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  a public.operational_assignments;
  j public.jobs;
  token public.operational_codes;
  distance_meters double precision;
BEGIN
  PERFORM public.operational_context(p_job_id);
  SELECT * INTO a FROM public.operational_assignments WHERE job_id=p_job_id FOR UPDATE;
  SELECT * INTO STRICT j FROM public.jobs WHERE id=p_job_id;
  IF p_stage IS NULL OR p_stage NOT IN ('checkin','checkout') OR a.interruption IS NOT NULL THEN
    RAISE EXCEPTION 'Etapa indisponível.';
  END IF;
  IF p_stage='checkin' THEN
    IF auth.uid()<>a.worker_id OR a.checkin_at IS NOT NULL
      OR (now() AT TIME ZONE 'America/Sao_Paulo')::date < j.job_date THEN
      RAISE EXCEPTION 'O profissional pode gerar o código ao chegar no dia da demanda.' USING ERRCODE='42501';
    END IF;
    IF p_latitude IS NULL OR p_longitude IS NULL
      OR p_latitude NOT BETWEEN -90 AND 90 OR p_longitude NOT BETWEEN -180 AND 180 THEN
      RAISE EXCEPTION 'Não foi possível obter uma localização válida. Permita o acesso ao GPS e tente novamente.'
        USING ERRCODE='22023';
    END IF;
    IF j.work_latitude IS NULL OR j.work_longitude IS NULL
      OR j.work_latitude NOT BETWEEN -90 AND 90 OR j.work_longitude NOT BETWEEN -180 AND 180 THEN
      RAISE EXCEPTION 'O local da operação não possui coordenadas válidas. Contate o restaurante.'
        USING ERRCODE='22023';
    END IF;
    distance_meters := 6371000 * 2 * asin(sqrt(LEAST(1.0, GREATEST(0.0,
      power(sin(radians(p_latitude - j.work_latitude) / 2), 2)
      + cos(radians(j.work_latitude)) * cos(radians(p_latitude))
      * power(sin(radians(p_longitude - j.work_longitude) / 2), 2)
    ))));
    IF distance_meters > 100 THEN
      RAISE EXCEPTION 'Você está fora do raio de 100 metros do local da operação. Aproxime-se e tente novamente.'
        USING ERRCODE='22023';
    END IF;
  ELSE
    IF auth.uid()<>a.restaurant_id OR a.receipt_confirmed_at IS NULL OR a.checkout_at IS NOT NULL THEN
      RAISE EXCEPTION 'Checkout disponível após o profissional confirmar recebimento.' USING ERRCODE='42501';
    END IF;
  END IF;
  SELECT * INTO token FROM public.operational_codes WHERE assignment_id=a.id AND stage=p_stage;
  IF token.blocked_until>now() THEN RAISE EXCEPTION 'Muitas tentativas. Aguarde dez minutos.'; END IF;
  IF token.expires_at IS NULL OR token.expires_at<=now() THEN
    INSERT INTO public.operational_codes(assignment_id,stage,code,expires_at,attempts)
      VALUES(a.id,p_stage,upper(left(replace(gen_random_uuid()::text,'-',''),8)),now()+interval '10 minutes',0)
      ON CONFLICT(assignment_id,stage) DO UPDATE SET code=EXCLUDED.code,expires_at=EXCLUDED.expires_at,
        attempts=0,blocked_until=NULL,consumed_at=NULL;
    INSERT INTO public.notifications(user_id,title,message,category,url)
    VALUES(CASE WHEN p_stage='checkin' THEN a.restaurant_id ELSE a.worker_id END,
      CASE WHEN p_stage='checkin' THEN 'Profissional chegou' ELSE 'Checkout liberado' END,
      CASE WHEN p_stage='checkin' THEN 'Confira a chegada e digite o código apresentado pelo profissional.'
        ELSE 'Solicite à empresa o código de checkout.' END,'operational','/'||p_stage||'/'||p_job_id);
  END IF;
  RETURN public.operational_context(p_job_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_operational_code(uuid,text,double precision,double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_operational_code(uuid,text,double precision,double precision) TO authenticated;

COMMIT;
NOTIFY pgrst,'reload schema';
