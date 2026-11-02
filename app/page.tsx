import Link from 'next/link';
import { DashboardLogo } from '@/app/components/dashboard-identity';

export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f6f3] px-6 py-16">
      <section className="w-full max-w-xl space-y-6 rounded-xl border border-gray-200 bg-white p-8 shadow-sm sm:p-10">
        <DashboardLogo />
        <h1 className="text-3xl font-bold text-gray-950">Plantões melhores começam aqui.</h1>
        <p className="max-w-prose text-gray-600">
          Encontre profissionais para sua operação ou descubra novas oportunidades na cozinha.
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <Link href="/login" className="inline-flex min-h-11 items-center rounded-lg bg-orange-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-orange-800">
            Entrar
          </Link>
          <Link href="/register" className="inline-flex min-h-11 items-center rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-semibold text-gray-800 transition hover:bg-gray-50">
            Criar conta
          </Link>
        </div>
      </section>
    </main>
  );
}