'use client';

import { Button, LoadingSkeleton, TextArea, Toast } from '@/app/components/ui';
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import MobileBottomNav from '@/app/components/mobile-bottom-nav';

interface ReviewContext {
  job_title: string;
  restaurant_id: string;
  worker_id: string;
  reviewed_id: string;
  reviewed_name: string;
  existing_rating: number | null;
  existing_comment: string | null;
}

export default function ReviewClient({ jobId }: { jobId: string }) {
  const [supabase] = useState(() => createClient());
  const [context, setContext] = useState<ReviewContext | null>(null);
  const [reviewerId, setReviewerId] = useState('');
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    let isMounted = true;

    async function loadReviewContext() {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) {
        if (isMounted) {
          setErrorMessage('Entre na sua conta para avaliar esta diária.');
          setLoading(false);
        }
        return;
      }

      const { data, error } = await supabase.rpc('get_review_context_with_participants', {
        p_job_id: jobId,
      });

      if (!isMounted) return;

      if (error) {
        setErrorMessage(error.message);
      } else {
        const reviewContext = (Array.isArray(data) ? data[0] : data) as ReviewContext | null;
        if (!reviewContext) {
          setErrorMessage('Não foi possível carregar os dados desta avaliação.');
        } else {
          setContext(reviewContext);
          setReviewerId(authData.user.id);
          if (reviewContext.existing_rating) {
            setRating(reviewContext.existing_rating);
            setComment(reviewContext.existing_comment ?? '');
          }
        }
      }

      setLoading(false);
    }

    void loadReviewContext();

    return () => {
      isMounted = false;
    };
  }, [jobId, supabase]);

  const submitReview = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!context || !reviewerId || rating < 1 || rating > 5 || sending || context.existing_rating) return;

    setSending(true);
    setErrorMessage('');

    const { data, error } = await supabase
      .from('reviews')
      .insert({
        job_id: jobId,
        restaurant_id: context.restaurant_id,
        worker_id: context.worker_id,
        reviewer_id: reviewerId,
        reviewed_id: context.reviewed_id,
        rating,
        comment: comment.trim(),
      })
      .select('rating, comment')
      .single();

    if (error) {
      setErrorMessage(error.code === '23505'
        ? 'Você já enviou uma avaliação para esta diária.'
        : error.message);
    } else {
      setContext((current) => current
        ? {
            ...current,
            existing_rating: data.rating,
            existing_comment: data.comment,
          }
        : current);
      setSuccessMessage('Avaliação enviada com sucesso.');
    }

    setSending(false);
  };

  const hasReviewed = context?.existing_rating !== null && context?.existing_rating !== undefined;
  const currentRole = reviewerId && context?.restaurant_id === reviewerId ? 'restaurant' : 'worker';

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-6 pb-28 sm:px-6 sm:py-10 md:pb-10">
      <section className="mx-auto max-w-xl space-y-6">
        <header className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-emerald-700">ExtraChef</p>
            <h1 className="mt-1 text-2xl font-bold text-gray-900">Avaliação da diária</h1>
          </div>
          <Link href="/worker/applications" className="text-sm font-medium text-gray-600 hover:text-emerald-700">
            Minhas diárias
          </Link>
        </header>

        {loading ? (
          <LoadingSkeleton label="Carregando avaliação..." />
        ) : errorMessage && !context ? (
          <div className="space-y-4 rounded-xl border border-red-200 bg-white p-6">
            <Toast tone="error">{errorMessage}</Toast>
            <Link href="/login" className="text-sm font-semibold text-emerald-700 hover:underline">
              Fazer login
            </Link>
          </div>
        ) : context ? (
          <article className="space-y-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
            <div>
              <p className="text-xs font-semibold uppercase text-gray-500">{context.job_title}</p>
              <h2 className="mt-2 text-xl font-bold text-gray-900">{context.reviewed_name}</h2>
              <p className="mt-1 text-sm text-gray-500">Como foi trabalhar com esta pessoa?</p>
            </div>

            {successMessage && (
              <Toast tone="success">{successMessage}</Toast>
            )}
            {errorMessage && (
              <Toast tone="error">{errorMessage}</Toast>
            )}

            {hasReviewed ? (
              <div className="space-y-3 border-t border-gray-100 pt-5">
                <p className="text-sm font-semibold text-gray-800">Sua avaliação</p>
                <div aria-label={`Nota ${context.existing_rating} de 5`} className="text-2xl text-amber-500">
                  {'★'.repeat(context.existing_rating ?? 0)}{'☆'.repeat(5 - (context.existing_rating ?? 0))}
                </div>
                {context.existing_comment && (
                  <p className="whitespace-pre-wrap text-sm text-gray-600">{context.existing_comment}</p>
                )}
              </div>
            ) : (
              <form onSubmit={submitReview} className="space-y-5 border-t border-gray-100 pt-5">
                <fieldset>
                  <legend className="mb-2 text-sm font-medium text-gray-700">Nota</legend>
                  <div className="flex gap-1" role="radiogroup" aria-label="Nota de 1 a 5 estrelas">
                    {[1, 2, 3, 4, 5].map((value) => (
                      <Button
                        key={value}
                        type="button"
                        role="radio"
                        tabIndex={rating === value || (rating === 0 && value === 1) ? 0 : -1}
                        aria-checked={rating === value}
                        aria-label={`${value} ${value === 1 ? 'estrela' : 'estrelas'}`}
                        onClick={() => setRating(value)}
                        onKeyDown={(event) => {
                          const offset = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1
                            : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
                          if (!offset) return;
                          event.preventDefault();
                          const next = (value - 1 + offset + 5) % 5 + 1;
                          setRating(next);
                          event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next - 1]?.focus();
                        }}
                        className={`size-12 rounded-md text-3xl leading-none transition ${rating >= value ? 'text-amber-700' : 'text-gray-500 hover:text-amber-700'}`}
                      >
                        ★
                      </Button>
                    ))}
                  </div>
                </fieldset>

                <div>
                  <label htmlFor="review-comment" className="mb-2 block text-sm font-medium text-gray-700">
                    Comentário <span className="font-normal text-gray-400">(opcional)</span>
                  </label>
                  <TextArea
                    id="review-comment"
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                    maxLength={2000}
                    rows={4}
                    placeholder="Compartilhe um comentário sobre a diária..."
                    className="w-full resize-y"
                  />
                  <p className="mt-1 text-right text-xs text-gray-400">{comment.length}/2000</p>
                </div>

                <Button variant="primary"
                  type="submit"
                  disabled={sending || rating === 0}
                  className="inline-flex w-full items-center justify-center px-5 py-3 text-base"
                >
                  {sending ? 'Enviando...' : 'Enviar Avaliação'}
                </Button>
              </form>
            )}
          </article>
        ) : null}
      </section>
      {context && <MobileBottomNav role={currentRole} />}
    </main>
  );
}