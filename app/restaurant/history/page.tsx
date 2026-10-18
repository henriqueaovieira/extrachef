import Link from 'next/link';
import MobileBottomNav from '@/app/components/mobile-bottom-nav';
import { EmptyState } from '@/app/components/ui';

export default function RestaurantOperationalHistoryPage() {
  return (
    <main className="min-h-screen bg-[#fafaf9] px-4 py-6 pb-28 text-gray-950 sm:px-8 sm:py-9">
      <section className="mx-auto max-w-2xl space-y-5">
        <header>
          <Link href="/restaurant/more" className="mb-3 inline-flex min-h-9 items-center text-xs font-semibold text-gray-500">← Mais</Link>
          <h1 className="text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">Histórico Operacional</h1>
          <p className="mt-2 text-sm leading-6 text-gray-600">Operações concluídas e avaliações</p>
        </header>
        <EmptyState icon="🗂️" title="Ainda não houve nenhuma operação concluída."
          description="As operações finalizadas aparecerão aqui." />
      </section>
      <MobileBottomNav role="restaurant" showOnDesktop />
    </main>
  );
}
