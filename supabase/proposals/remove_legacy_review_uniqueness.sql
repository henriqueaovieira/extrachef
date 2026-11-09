ALTER TABLE public.reviews
  DROP CONSTRAINT IF EXISTS unique_job_review_per_author;
