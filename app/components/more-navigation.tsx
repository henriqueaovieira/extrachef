import Link from 'next/link';
import MobileBottomNav from '@/app/components/mobile-bottom-nav';
import LogoutButton from '@/app/components/logout-button';
import { DashboardLogo } from '@/app/components/dashboard-identity';

type AccountRole = 'restaurant' | 'worker';

const links: Record<AccountRole, Array<{ href: string; label: string; description: string }>> = {
  restaurant: [
    { href: '/restaurant/profile', label: 'Meu Perfil', description: 'Sua conta e informações da empresa' },
    { href: '/restaurant/locations', label: 'Locais operacionais', description: 'Endereço principal e locais das operações' },
    { href: '/restaurant/history', label: 'Histórico Operacional', description: 'Operações concluídas e avaliações' },
    { href: '/notifications', label: 'Notificações', description: 'Atualizações importantes' },
    { href: '/settings/privacy', label: 'Privacidade e Preferências', description: 'Dados e notificações' },
  ],
  worker: [
    { href: '/worker/profile', label: 'Meu Perfil', description: 'Seus dados e informações profissionais' },
    { href: '/worker/profile#verification', label: 'Perfil Verificado', description: 'Confirme sua identidade para obter o selo' },
    { href: '/worker/dashboard#historico', label: 'Histórico Operacional', description: 'Suas diárias em andamento e concluídas' },
    { href: '/worker/profile#confidence', label: 'Confiança', description: 'Sua reputação e indicadores operacionais' },
    { href: '/notifications', label: 'Notificações', description: 'Atualizações importantes' },
    { href: '/settings/privacy', label: 'Privacidade e Preferências', description: 'Dados e notificações' },
  ],
};

export function MoreNavigationLinks({ role }: { role: AccountRole }) {
  return <div className="divide-y divide-gray-100">
    {links[role].map((link) => (
      <Link key={link.href} href={link.href} className="flex min-h-20 items-center justify-between gap-4 py-4">
        <span><span className="block font-semibold">{link.label}</span><span className="mt-1 block text-sm text-gray-500">{link.description}</span></span>
        <span aria-hidden="true" className="text-gray-400">→</span>
      </Link>
    ))}
  </div>;
}

export default function MoreNavigation({ role }: { role: AccountRole }) {
  return (
    <main className="min-h-screen bg-white px-5 py-8 pb-28 text-gray-950 sm:px-8">
      <section className="mx-auto max-w-2xl space-y-6">
        <header className="mb-8">
          <DashboardLogo role={role} />
        </header>
        <h1 className="text-2xl font-semibold tracking-tight">Mais</h1>
        <MoreNavigationLinks role={role} />
        <LogoutButton />
      </section>
      <MobileBottomNav role={role} showOnDesktop />
    </main>
  );
}
