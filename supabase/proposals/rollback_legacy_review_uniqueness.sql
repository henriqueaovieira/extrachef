ALTER TABLE public.reviews
  ADD CONSTRAINT unique_job_review_per_author
  UNIQUE (job_id, worker_id, restaurant_id);
