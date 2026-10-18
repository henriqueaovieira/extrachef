BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.reviews ADD COLUMN would_work_again boolean;
GRANT INSERT(would_work_again), SELECT(would_work_again) ON public.reviews TO authenticated;
CREATE FUNCTION public.require_review_relationship_answer()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  IF NEW.would_work_again IS NULL THEN
    RAISE EXCEPTION 'Informe se trabalharia novamente nesta relação.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.require_review_relationship_answer() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER reviews_relationship_answer BEFORE INSERT ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.require_review_relationship_answer();

CREATE TABLE public.operational_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL UNIQUE REFERENCES public.applications(id) ON DELETE CASCADE,
  job_id uuid NOT NULL UNIQUE REFERENCES public.jobs(id) ON DELETE CASCADE,
  worker_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  hired_at timestamptz,
  amount numeric NOT NULL CHECK(amount > 0),
  checkin_at timestamptz,
  paid_at timestamptz,
  receipt_confirmed_at timestamptz,
  payment_disputed_at timestamptz,
  checkout_at timestamptz,
  interruption text CHECK(interruption IN ('cancelled','absent','abandoned')),
  interrupted_at timestamptz,
  replacement_job_id uuid REFERENCES public.jobs(id),
  CHECK(checkout_at IS NULL OR checkin_at IS NOT NULL)
);
CREATE INDEX operational_worker_idx ON public.operational_assignments(worker_id, hired_at);
ALTER TABLE public.operational_assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.operational_assignments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.operational_assignments TO authenticated;
CREATE POLICY operational_participants ON public.operational_assignments FOR SELECT TO authenticated
  USING(auth.uid() IN (worker_id, restaurant_id));

CREATE TABLE public.operational_codes (
  assignment_id uuid NOT NULL REFERENCES public.operational_assignments(id) ON DELETE CASCADE,
  stage text NOT NULL CHECK(stage IN ('checkin','checkout')),
  code text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  blocked_until timestamptz,
  consumed_at timestamptz,
  PRIMARY KEY(assignment_id,stage)
);
ALTER TABLE public.operational_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.operational_codes FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.operational_start(p_job public.jobs)
RETURNS timestamptz LANGUAGE sql IMMUTABLE SET search_path = '' AS $fn$
  SELECT (p_job.job_date + p_job.start_time) AT TIME ZONE 'America/Sao_Paulo';
$fn$;
CREATE FUNCTION public.operational_end(p_job public.jobs)
RETURNS timestamptz LANGUAGE sql IMMUTABLE SET search_path = '' AS $fn$
  SELECT (p_job.job_date + p_job.end_time +
    CASE WHEN p_job.end_time <= p_job.start_time THEN interval '1 day' ELSE interval '0' END)
    AT TIME ZONE 'America/Sao_Paulo';
$fn$;
REVOKE ALL ON FUNCTION public.operational_start(public.jobs), public.operational_end(public.jobs) FROM PUBLIC, anon, authenticated;

INSERT INTO public.operational_assignments(application_id,job_id,worker_id,restaurant_id,hired_at,amount,checkin_at,checkout_at)
SELECT a.id,j.id,a.worker_id,j.restaurant_id,
  (SELECT min(e.occurred_at) FROM public.demand_events e
    WHERE e.demand_id=j.demand_id AND e.worker_id=a.worker_id AND e.kind='hired'),
  j.value,c.checkin_time,o.checkout_time
FROM public.applications a JOIN public.jobs j ON j.id=a.job_id
LEFT JOIN public.checkins c ON c.job_id=a.job_id AND c.worker_id=a.worker_id
LEFT JOIN public.checkouts o ON o.job_id=a.job_id AND o.worker_id=a.worker_id
WHERE a.status IN ('approved','in_progress','completed');

CREATE FUNCTION public.capture_operational_hire()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  IF NEW.status='approved' AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.operational_assignments(application_id,job_id,worker_id,restaurant_id,hired_at,amount)
    SELECT NEW.id,j.id,NEW.worker_id,j.restaurant_id,now(),j.value FROM public.jobs j WHERE j.id=NEW.job_id;
    INSERT INTO public.notifications(user_id,title,message,category,url)
      SELECT j.restaurant_id,'Equipe atualizada','Profissional contratado. Confira a equipe desta operação.',
        'operational','/restaurant/demands/'||j.demand_id||'#hired-heading' FROM public.jobs j WHERE j.id=NEW.job_id;
  END IF;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.capture_operational_hire() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER applications_operational_hire AFTER UPDATE OF status ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.capture_operational_hire();

CREATE FUNCTION public.pending_operational_reviews()
RETURNS TABLE(job_id uuid, title text, reviewed_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT j.id,j.title,u.name
  FROM public.operational_assignments a JOIN public.jobs j ON j.id=a.job_id
  JOIN public.users u ON u.id=CASE WHEN auth.uid()=a.worker_id THEN a.restaurant_id ELSE a.worker_id END
  WHERE auth.uid() IN (a.worker_id,a.restaurant_id) AND a.checkout_at IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM public.reviews r WHERE r.job_id=a.job_id AND r.reviewer_id=auth.uid())
  ORDER BY a.checkout_at,j.id;
$fn$;
REVOKE ALL ON FUNCTION public.pending_operational_reviews() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pending_operational_reviews() TO authenticated;

CREATE FUNCTION public.require_operational_reviews()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE actor uuid;
BEGIN
  actor := (to_jsonb(NEW)->>CASE WHEN TG_TABLE_NAME='jobs' THEN 'restaurant_id' ELSE 'worker_id' END)::uuid;
  IF TG_TABLE_NAME='jobs' AND EXISTS(SELECT 1 FROM public.jobs j
    WHERE j.demand_id=(to_jsonb(NEW)->>'demand_id')::uuid AND j.restaurant_id=actor) THEN
    RETURN NEW;
  END IF;
  PERFORM 1 FROM public.users WHERE id=actor FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.operational_assignments a
    WHERE (CASE WHEN TG_TABLE_NAME='jobs' THEN a.restaurant_id ELSE a.worker_id END)=actor
    AND a.checkout_at IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM public.reviews r WHERE r.job_id=a.job_id AND r.reviewer_id=actor)) THEN
    IF TG_TABLE_NAME='jobs' THEN
      RAISE EXCEPTION 'Antes de criar uma nova demanda, avalie sua última experiência.' USING ERRCODE='23514';
    ELSE
      RAISE EXCEPTION 'Antes de se candidatar novamente, avalie sua última experiência.' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.require_operational_reviews() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER jobs_operational_reviews BEFORE INSERT ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.require_operational_reviews();
CREATE TRIGGER applications_00_operational_reviews BEFORE INSERT ON public.applications FOR EACH ROW EXECUTE FUNCTION public.require_operational_reviews();

CREATE FUNCTION public.operational_context(p_job_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE a public.operational_assignments; j public.jobs; token public.operational_codes; phase text; issuer boolean;
BEGIN
  SELECT * INTO a FROM public.operational_assignments WHERE job_id=p_job_id;
  IF NOT FOUND OR auth.uid() IS NULL OR auth.uid() NOT IN (a.worker_id,a.restaurant_id)
    OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=auth.uid() AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Operação indisponível para esta conta.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO STRICT j FROM public.jobs WHERE id=p_job_id;
  phase := CASE WHEN a.interruption IS NOT NULL THEN a.interruption
    WHEN a.checkout_at IS NOT NULL THEN 'completed'
    WHEN a.checkin_at IS NULL THEN
      CASE WHEN now()>public.operational_start(j)+interval '5 minutes' THEN 'absence_pending'
        WHEN (now() AT TIME ZONE 'America/Sao_Paulo')::date < j.job_date THEN 'confirmed'
        ELSE 'checkin' END
    WHEN now()<public.operational_end(j) THEN 'working'
    WHEN a.receipt_confirmed_at IS NOT NULL THEN 'checkout'
    WHEN a.payment_disputed_at IS NOT NULL THEN 'payment_disputed'
    WHEN a.paid_at IS NOT NULL THEN 'receipt'
    ELSE 'payment' END;
  SELECT * INTO token FROM public.operational_codes WHERE assignment_id=a.id
    AND stage=CASE WHEN a.checkin_at IS NULL THEN 'checkin' ELSE 'checkout' END;
  issuer := CASE WHEN a.checkin_at IS NULL THEN auth.uid()=a.worker_id ELSE auth.uid()=a.restaurant_id END;
  RETURN jsonb_build_object('job_id',j.id,'demand_id',j.demand_id,'title',j.title,
    'location',COALESCE(j.location_name,j.work_address,'Local a definir'),
    'starts_at',public.operational_start(j),'ends_at',public.operational_end(j),
    'role',CASE WHEN auth.uid()=a.worker_id THEN 'worker' ELSE 'restaurant' END,
    'worker_name',(SELECT name FROM public.users WHERE id=a.worker_id),
    'phase',phase,'amount',a.amount,'checkin_at',a.checkin_at,'paid_at',a.paid_at,
    'receipt_confirmed_at',a.receipt_confirmed_at,'checkout_at',a.checkout_at,
    'code',CASE WHEN issuer AND token.expires_at>now() AND token.consumed_at IS NULL THEN token.code END,
    'code_expires_at',CASE WHEN issuer AND token.consumed_at IS NULL THEN token.expires_at END,
    'has_code',COALESCE(token.expires_at>now() AND token.consumed_at IS NULL,false),
    'review_pending',a.checkout_at IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM public.reviews r WHERE r.job_id=j.id AND r.reviewer_id=auth.uid()));
END;
$fn$;
REVOKE ALL ON FUNCTION public.operational_context(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operational_context(uuid) TO authenticated;

CREATE FUNCTION public.issue_operational_code(p_job_id uuid,p_stage text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE a public.operational_assignments; j public.jobs; token public.operational_codes;
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
REVOKE ALL ON FUNCTION public.issue_operational_code(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_operational_code(uuid,text) TO authenticated;

CREATE FUNCTION public.validate_operational_code(p_job_id uuid,p_stage text,p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE a public.operational_assignments; j public.jobs; token public.operational_codes;
BEGIN
  PERFORM public.operational_context(p_job_id);
  SELECT * INTO a FROM public.operational_assignments WHERE job_id=p_job_id FOR UPDATE;
  SELECT * INTO STRICT j FROM public.jobs WHERE id=p_job_id;
  IF p_stage IS NULL OR p_stage NOT IN ('checkin','checkout') OR a.interruption IS NOT NULL THEN
    RAISE EXCEPTION 'Etapa indisponível.';
  END IF;
  IF p_stage='checkin' THEN
    IF auth.uid()<>a.restaurant_id OR a.checkin_at IS NOT NULL THEN
      RAISE EXCEPTION 'Somente a empresa confirma a chegada.' USING ERRCODE='42501';
    END IF;
  ELSE
    IF auth.uid()<>a.worker_id OR a.receipt_confirmed_at IS NULL OR a.checkout_at IS NOT NULL THEN
      RAISE EXCEPTION 'Confirme o recebimento antes de validar o checkout.' USING ERRCODE='42501';
    END IF;
  END IF;
  SELECT * INTO token FROM public.operational_codes WHERE assignment_id=a.id AND stage=p_stage FOR UPDATE;
  IF token.blocked_until>now() THEN
    RETURN jsonb_build_object('error','Muitas tentativas. Aguarde dez minutos.');
  END IF;
  IF token.code IS NULL OR token.expires_at<=now() OR token.consumed_at IS NOT NULL THEN
    RETURN jsonb_build_object('error','Código expirado ou indisponível. Solicite um novo código.');
  END IF;
  IF upper(btrim(COALESCE(p_code,'')))<>token.code THEN
    UPDATE public.operational_codes SET attempts=attempts+1,
      blocked_until=CASE WHEN attempts+1>=5 THEN now()+interval '10 minutes' END
      WHERE assignment_id=a.id AND stage=p_stage;
    RETURN jsonb_build_object('error','Código incorreto. Confira o código com a outra pessoa.');
  END IF;
  IF p_stage='checkin' THEN
    INSERT INTO public.checkins(job_id,worker_id,checkin_time) VALUES(j.id,a.worker_id,now());
    UPDATE public.operational_assignments SET checkin_at=now() WHERE id=a.id;
    UPDATE public.applications SET status='in_progress' WHERE id=a.application_id;
    PERFORM public.record_demand_event(j.demand_id,
      CASE WHEN now()<public.operational_start(j) THEN 'early'
        WHEN now()<=public.operational_start(j)+interval '5 minutes' THEN 'on_time' ELSE 'late' END,
      a.worker_id,'arrival:'||a.id);
  ELSE
    INSERT INTO public.checkouts(job_id,worker_id,checkout_time) VALUES(j.id,a.worker_id,now());
    UPDATE public.operational_assignments SET checkout_at=now() WHERE id=a.id;
    UPDATE public.applications SET status='completed' WHERE id=a.application_id;
    UPDATE public.jobs SET status='completed' WHERE id=j.id;
    INSERT INTO public.notifications(user_id,title,message,category,url)
      SELECT recipient,'Avaliação pendente','Trabalho concluído com sucesso. Avalie antes da sua próxima operação.',
        'review','/reviews/'||j.id FROM unnest(ARRAY[a.restaurant_id,a.worker_id]) recipient;
  END IF;
  UPDATE public.operational_codes SET consumed_at=now() WHERE assignment_id=a.id AND stage=p_stage;
  RETURN public.operational_context(p_job_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.validate_operational_code(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_operational_code(uuid,text,text) TO authenticated;

REVOKE ALL ON FUNCTION public.register_worker_checkin(uuid,double precision,double precision),
  public.register_worker_checkout(uuid,double precision,double precision) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.record_operational_payment(p_job_id uuid,p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE a public.operational_assignments; j public.jobs;
BEGIN
  PERFORM public.operational_context(p_job_id);
  SELECT * INTO a FROM public.operational_assignments WHERE job_id=p_job_id FOR UPDATE;
  SELECT * INTO STRICT j FROM public.jobs WHERE id=p_job_id;
  IF a.interruption IS NOT NULL OR a.checkin_at IS NULL OR a.checkout_at IS NOT NULL
    OR now()<public.operational_end(j) OR a.receipt_confirmed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Pagamento indisponível nesta etapa.';
  END IF;
  IF p_action='paid' AND auth.uid()=a.restaurant_id THEN
    IF a.paid_at IS NOT NULL AND a.payment_disputed_at IS NULL THEN RAISE EXCEPTION 'Pagamento já registrado.'; END IF;
    UPDATE public.operational_assignments SET paid_at=now(),payment_disputed_at=NULL WHERE id=a.id;
    PERFORM public.record_demand_event(j.demand_id,'payment_reported',a.worker_id,'paid:'||a.id||':'||now());
    INSERT INTO public.notifications(user_id,title,message,category,url)
      VALUES(a.worker_id,'Você recebeu o pagamento?','A empresa informou o pagamento. Confira antes de confirmar.',
        'operational','/payment/'||j.id);
  ELSIF p_action IN ('received','not_received') AND auth.uid()=a.worker_id AND a.paid_at IS NOT NULL THEN
    IF p_action='received' THEN
      UPDATE public.operational_assignments SET receipt_confirmed_at=now(),payment_disputed_at=NULL WHERE id=a.id;
      INSERT INTO public.operational_codes(assignment_id,stage,code,expires_at)
        VALUES(a.id,'checkout',upper(left(replace(gen_random_uuid()::text,'-',''),8)),now()+interval '10 minutes');
      PERFORM public.record_demand_event(j.demand_id,'payment_confirmed',a.worker_id,'receipt:'||a.id);
      INSERT INTO public.notifications(user_id,title,message,category,url)
        VALUES(a.restaurant_id,'Pagamento confirmado','O profissional confirmou recebimento. Gere o código de checkout.',
          'operational','/checkout/'||j.id);
    ELSE
      IF a.payment_disputed_at IS NOT NULL THEN RAISE EXCEPTION 'A empresa já foi avisada do não recebimento.'; END IF;
      UPDATE public.operational_assignments SET payment_disputed_at=now() WHERE id=a.id;
      PERFORM public.record_demand_event(j.demand_id,'payment_disputed',a.worker_id,'dispute:'||a.id||':'||now());
      INSERT INTO public.notifications(user_id,title,message,category,url)
        VALUES(a.restaurant_id,'Pagamento não recebido','Confira o pagamento com o profissional.',
          'operational','/payment/'||j.id);
    END IF;
  ELSE
    RAISE EXCEPTION 'Ação de pagamento não autorizada.' USING ERRCODE='42501';
  END IF;
  RETURN public.operational_context(p_job_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.record_operational_payment(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_operational_payment(uuid,text) TO authenticated;

CREATE FUNCTION public.interrupt_operational_assignment(p_job_id uuid,p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE a public.operational_assignments; j public.jobs; replacement public.jobs;
BEGIN
  PERFORM public.operational_context(p_job_id);
  SELECT * INTO a FROM public.operational_assignments WHERE job_id=p_job_id;
  PERFORM 1 FROM public.users WHERE id=a.restaurant_id FOR UPDATE;
  SELECT * INTO STRICT j FROM public.jobs WHERE id=p_job_id FOR UPDATE;
  SELECT * INTO a FROM public.operational_assignments WHERE job_id=p_job_id FOR UPDATE;
  IF p_reason IS NULL OR p_reason NOT IN ('cancelled','absent','abandoned') OR a.interruption IS NOT NULL
    OR a.checkout_at IS NOT NULL OR a.paid_at IS NOT NULL THEN RAISE EXCEPTION 'Interrupção indisponível nesta etapa.'; END IF;
  IF p_reason='cancelled' THEN
    IF a.checkin_at IS NOT NULL OR auth.uid() NOT IN (a.worker_id,a.restaurant_id) THEN RAISE EXCEPTION 'Cancelamento disponível antes do check-in.'; END IF;
  ELSIF auth.uid()<>a.restaurant_id THEN
    RAISE EXCEPTION 'Somente a empresa confirma esta ocorrência.' USING ERRCODE='42501';
  ELSIF p_reason='absent' AND (a.checkin_at IS NOT NULL OR now()<=public.operational_start(j)+interval '5 minutes') THEN
    RAISE EXCEPTION 'Aguarde a tolerância de cinco minutos e confira a chegada.';
  ELSIF p_reason='abandoned' AND (a.checkin_at IS NULL OR now()>=public.operational_end(j)) THEN
    RAISE EXCEPTION 'Abandono disponível apenas durante o trabalho.';
  END IF;
  UPDATE public.operational_assignments SET interruption=p_reason,interrupted_at=now() WHERE id=a.id;
  UPDATE public.applications SET status='rejected' WHERE id=a.application_id;
  UPDATE public.jobs SET status='cancelled' WHERE id=j.id;
  replacement := jsonb_populate_record(NULL::public.jobs,to_jsonb(j)||
    jsonb_build_object('id',gen_random_uuid(),'status','open','created_at',now(),'demand_archived_at',NULL));
  INSERT INTO public.jobs SELECT (replacement).*;
  UPDATE public.applications SET job_id=replacement.id WHERE job_id=j.id AND status='pending';
  UPDATE public.operational_assignments SET replacement_job_id=replacement.id WHERE id=a.id;
  PERFORM public.record_demand_event(j.demand_id,p_reason,a.worker_id,'interruption:'||a.id);
  PERFORM public.record_demand_event(j.demand_id,'position_reopened',a.worker_id,'reopened:'||a.id);
  INSERT INTO public.notifications(user_id,title,message,category,url)
  VALUES(a.restaurant_id,'Posição reaberta','Confira os candidatos e a reserva para confirmar uma substituição.',
      'operational','/restaurant/demands/'||j.demand_id||'#reserve-heading'),
    (a.worker_id,'Ocorrência registrada','Foi registrado: '||
      CASE p_reason WHEN 'absent' THEN 'ausência' WHEN 'abandoned' THEN 'abandono' ELSE 'cancelamento' END||
      '. Confira sua operação.',
      'operational','/checkin/'||j.id);
  RETURN replacement.id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.interrupt_operational_assignment(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.interrupt_operational_assignment(uuid,text) TO authenticated;

CREATE FUNCTION public.worker_operational_reputation(p_worker_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE hires numeric; arrivals numeric; finishes numeric; early_count bigint; timely bigint; late_count bigint;
  absent_count bigint; cancellations bigint; abandons bigint; repeats numeric; average_rating numeric;
  presence numeric; punctuality numeric; score numeric; visible boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_worker_id AND role='worker' AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Perfil indisponível.' USING ERRCODE='42501';
  END IF;
  SELECT auth.uid()=p_worker_id OR COALESCE(p.show_score,false) INTO visible
    FROM public.users u LEFT JOIN public.privacy_preferences p ON p.user_id=u.id WHERE u.id=p_worker_id;
  IF NOT visible THEN RETURN NULL; END IF;
  SELECT count(*),
    count(*) FILTER(WHERE a.checkin_at IS NOT NULL AND a.interruption IS DISTINCT FROM 'abandoned'),
    count(*) FILTER(WHERE a.checkin_at IS NOT NULL AND a.receipt_confirmed_at IS NOT NULL AND a.checkout_at IS NOT NULL),
    count(*) FILTER(WHERE a.checkin_at<public.operational_start(j)),
    count(*) FILTER(WHERE a.checkin_at>=public.operational_start(j) AND a.checkin_at<=public.operational_start(j)+interval '5 minutes'),
    count(*) FILTER(WHERE a.checkin_at>public.operational_start(j)+interval '5 minutes'),
    count(*) FILTER(WHERE a.interruption='absent'),
    count(*) FILTER(WHERE a.interruption='cancelled' AND a.interrupted_at>=now()-interval '90 days'),
    count(*) FILTER(WHERE a.interruption='abandoned' AND a.interrupted_at>=now()-interval '180 days')
    INTO hires,arrivals,finishes,early_count,timely,late_count,absent_count,cancellations,abandons
  FROM public.operational_assignments a JOIN public.jobs j ON j.id=a.job_id WHERE a.worker_id=p_worker_id;
  SELECT count(*) INTO repeats FROM public.operational_assignments a
    WHERE a.worker_id=p_worker_id AND a.hired_at IS NOT NULL AND EXISTS(
      SELECT 1 FROM public.operational_assignments previous WHERE previous.worker_id=p_worker_id
        AND previous.restaurant_id=a.restaurant_id AND previous.checkout_at<a.hired_at
        AND EXISTS(SELECT 1 FROM public.reviews r WHERE r.job_id=previous.job_id
          AND r.reviewer_id=a.restaurant_id AND r.would_work_again=true AND r.created_at<=a.hired_at));
  SELECT avg(rating) INTO average_rating FROM public.reviews WHERE reviewed_id=p_worker_id;
  presence := COALESCE(arrivals/NULLIF(hires,0)*100,0);
  punctuality := COALESCE((early_count+timely)*100/NULLIF(hires,0),0);
  score := CASE WHEN finishes<5 THEN 70 ELSE greatest(0,least(100,
    presence*0.35 + COALESCE(((early_count+timely)*100+late_count*70)/NULLIF(hires,0),0)*0.25
    + finishes/NULLIF(hires,0)*100*0.15 + COALESCE(average_rating/5*100,0)*0.10
    + least(100,repeats/NULLIF(finishes,0)*100)*0.10
    + CASE WHEN cancellations<=2 THEN 100 WHEN cancellations<=4 THEN 80 WHEN cancellations<=6 THEN 60 ELSE 40 END*0.05
    - least(abandons,3)*10)) END;
  score := round(score,2);
  RETURN jsonb_build_object('score',score,'classification',
    CASE WHEN finishes<5 THEN 'Em Desenvolvimento' WHEN score>=95 THEN 'Excelente'
      WHEN score>=85 THEN 'Muito Confiável' WHEN score>=70 THEN 'Confiável'
      WHEN score>=50 THEN 'Em Desenvolvimento' ELSE 'Atenção' END,
    'punctuality',CASE WHEN hires>0 THEN round(punctuality,2) END,
    'average_rating',round(average_rating,2),'completed',finishes,'rehires',repeats,
    'checkins',(SELECT count(*) FROM public.operational_assignments WHERE worker_id=p_worker_id AND checkin_at IS NOT NULL),
    'checkouts',(SELECT count(*) FROM public.operational_assignments WHERE worker_id=p_worker_id AND checkout_at IS NOT NULL),
    'early',early_count,'on_time',timely,'late',late_count,'absences',absent_count,
    'cancellations_90d',cancellations,'abandonments_180d',abandons);
END;
$fn$;
REVOKE ALL ON FUNCTION public.worker_operational_reputation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.worker_operational_reputation(uuid) TO authenticated;

ALTER FUNCTION public.demand_talent_directory(uuid,uuid,integer,integer,boolean) RENAME TO demand_talent_directory_before_trust;
REVOKE ALL ON FUNCTION public.demand_talent_directory_before_trust(uuid,uuid,integer,integer,boolean) FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.demand_talent_directory(p_demand_id uuid,p_worker_id uuid DEFAULT NULL,p_offset integer DEFAULT 0,p_limit integer DEFAULT 50,p_participants_only boolean DEFAULT false)
RETURNS TABLE(id uuid,name text,specialties text[],score numeric,photo_path text,experience text,categories text[],completed_operations bigint,invitation_status text,reputation jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT d.id,d.name,d.specialties,
    CASE WHEN d.score IS NOT NULL THEN (SELECT avg(r.rating) FROM public.reviews r WHERE r.reviewed_id=d.id) END,
    d.photo_path,d.experience,d.categories,d.completed_operations,d.invitation_status,public.worker_operational_reputation(d.id)
  FROM public.demand_talent_directory_before_trust(p_demand_id,p_worker_id,p_offset,p_limit,p_participants_only) d;
$fn$;
REVOKE ALL ON FUNCTION public.demand_talent_directory(uuid,uuid,integer,integer,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.demand_talent_directory(uuid,uuid,integer,integer,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.notify_application_approved()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  IF NEW.status='approved' AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.notifications(user_id,title,message,category,url)
      VALUES(NEW.worker_id,'Contratação confirmada','Você está confirmado para esta demanda. Confira seu próximo passo.',
        'operational','/checkin/'||NEW.job_id);
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE OR REPLACE FUNCTION public.notify_checkin_confirmed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  INSERT INTO public.notifications(user_id,title,message,category,url)
    SELECT restaurant_id,'Check-in confirmado','A chegada do profissional foi confirmada.',
      'operational','/checkin/'||NEW.job_id FROM public.jobs WHERE id=NEW.job_id;
  RETURN NEW;
END;
$fn$;
CREATE OR REPLACE FUNCTION public.notify_checkout_confirmed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  INSERT INTO public.notifications(user_id,title,message,category,url)
    SELECT restaurant_id,'Checkout concluído','Trabalho concluído com sucesso.',
      'operational','/checkout/'||NEW.job_id FROM public.jobs WHERE id=NEW.job_id;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.notify_application_received()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  INSERT INTO public.notifications(user_id,title,message,category,url)
    SELECT j.restaurant_id,'Nova candidatura recebida',u.name||' se candidatou para '||j.title,
      'application','/restaurant/demands/'||j.demand_id||'?view=candidates'
    FROM public.jobs j JOIN public.users u ON u.id=NEW.worker_id WHERE j.id=NEW.job_id;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.invite_demand_worker(p_demand_id uuid,p_worker_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE target public.jobs; invitation uuid;
BEGIN
  PERFORM 1 FROM public.users WHERE id=auth.uid() AND role='restaurant' AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entre na conta da empresa.' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.jobs WHERE demand_id=p_demand_id AND restaurant_id=auth.uid() ORDER BY id FOR UPDATE;
  SELECT * INTO target FROM public.jobs WHERE demand_id=p_demand_id AND restaurant_id=auth.uid()
    AND status='open' AND demand_archived_at IS NULL AND public.operational_end(jobs)>now() LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Não há posição aberta nesta demanda.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_worker_id AND role='worker' AND deleted_at IS NULL)
    OR EXISTS(SELECT 1 FROM public.applications a JOIN public.jobs j ON j.id=a.job_id
      WHERE j.demand_id=p_demand_id AND a.worker_id=p_worker_id AND a.status IN ('approved','in_progress','completed')) THEN
    RAISE EXCEPTION 'Este profissional não está disponível para convite.';
  END IF;
  INSERT INTO public.demand_invitations(demand_id,restaurant_id,worker_id)
    VALUES(p_demand_id,auth.uid(),p_worker_id) ON CONFLICT DO NOTHING RETURNING id INTO invitation;
  IF invitation IS NULL THEN RAISE EXCEPTION 'Este profissional já recebeu um convite para esta demanda.'; END IF;
  INSERT INTO public.notifications(user_id,title,message,category,url)
    VALUES(p_worker_id,'Convite para trabalhar',target.title||' · '||to_char(target.job_date,'DD/MM/YYYY'),
      'operational','/worker/invitations#invitation-'||invitation);
END;
$fn$;
REVOKE ALL ON FUNCTION public.invite_demand_worker(uuid,uuid), public.notify_application_received(),
  public.notify_application_approved(),public.notify_checkin_confirmed(),public.notify_checkout_confirmed()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invite_demand_worker(uuid,uuid) TO authenticated;

CREATE FUNCTION public.process_operational_schedule()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE a record; inserted integer; kind text; recipient uuid; destination text;
BEGIN
  FOR a IN SELECT o.*,j.demand_id,j.title,j.job_date,public.operational_start(j) starts_at,public.operational_end(j) ends_at
    FROM public.operational_assignments o JOIN public.jobs j ON j.id=o.job_id
    WHERE o.interruption IS NULL AND o.checkout_at IS NULL LOOP
    kind := CASE
      WHEN a.checkin_at IS NOT NULL AND now()>=a.ends_at THEN 'work_ended'
      WHEN a.checkin_at IS NULL AND now()>a.starts_at+interval '5 minutes' THEN 'absence_pending'
      WHEN a.job_date=(now() AT TIME ZONE 'America/Sao_Paulo')::date+1 THEN 'commitment_reminder'
      ELSE NULL END;
    IF kind IS NULL THEN CONTINUE; END IF;
    INSERT INTO public.demand_events(demand_id,kind,worker_id,source_key,occurred_at)
      VALUES(a.demand_id,kind,a.worker_id,'scheduled:'||kind||':'||a.id,
        CASE WHEN kind='work_ended' THEN a.ends_at ELSE now() END)
      ON CONFLICT(source_key) DO NOTHING;
    GET DIAGNOSTICS inserted = ROW_COUNT;
    IF inserted=0 THEN CONTINUE; END IF;
    FOREACH recipient IN ARRAY CASE WHEN kind='commitment_reminder' THEN ARRAY[a.worker_id] ELSE ARRAY[a.worker_id,a.restaurant_id] END LOOP
      destination := CASE WHEN kind='work_ended' THEN '/payment/' ELSE '/checkin/' END||a.job_id;
      INSERT INTO public.notifications(user_id,title,message,category,url)
      VALUES(recipient,CASE kind WHEN 'work_ended' THEN 'Trabalho encerrado'
        WHEN 'absence_pending' THEN 'Aguardando confirmação de ausência' ELSE 'Seu compromisso é amanhã' END,
        CASE kind WHEN 'work_ended' THEN 'Confira o pagamento para continuar o encerramento.'
        WHEN 'absence_pending' THEN 'Ainda não há check-in confirmado. Confira a chegada antes de registrar uma ausência.'
        ELSE 'Não se esqueça do seu compromisso amanhã: '||a.title END,'operational',destination);
    END LOOP;
  END LOOP;
END;
$fn$;
REVOKE ALL ON FUNCTION public.process_operational_schedule() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_operational_schedule() TO service_role;

ALTER FUNCTION public.export_own_account_data() RENAME TO export_account_before_operational_trust;
REVOKE ALL ON FUNCTION public.export_account_before_operational_trust() FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.export_own_account_data()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  RETURN public.export_account_before_operational_trust() || jsonb_build_object('operational_assignments',
    COALESCE((SELECT jsonb_agg(to_jsonb(a)) FROM public.operational_assignments a
      WHERE auth.uid() IN (a.worker_id,a.restaurant_id)),'[]'::jsonb));
END;
$fn$;
REVOKE ALL ON FUNCTION public.export_own_account_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.export_own_account_data() TO authenticated;
COMMIT;
NOTIFY pgrst,'reload schema';
