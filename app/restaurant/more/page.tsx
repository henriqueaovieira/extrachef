import Link from 'next/link';
import MobileBottomNav from '@/app/components/mobile-bottom-nav';
import LogoutButton from '@/app/components/logout-button';

const links = [
  { href: '/restaurant/profile', label: 'Meu perfil', description: 'Sua conta e informações da empresa' },
  { href: '/restaurant/events', label: 'Agenda', description: 'Eventos da sua operação' },
  { href: '/restaurant/history', label: 'Histórico Operacional', description: 'Operações concluídas e avaliações' },
  { href: '/restaurant/locations', label: 'Meus locais', description: 'Endereços de trabalho' },
  { href: '/notifications', label: 'Notificações', description: 'Atualizações importantes' },
  { href: '/settings/privacy', label: 'Privacidade e preferências', description: 'Dados e notificações' },
];

export default function RestaurantMore() {
  return (
    <main className="min-h-screen bg-white px-5 py-8 pb-28 text-gray-950 sm:px-8">
      <section className="mx-auto max-w-2xl space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">Mais</h1>
        <div className="divide-y divide-gray-100">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className="flex min-h-20 items-center justify-between gap-4 py-4">
              <span><span className="block font-semibold">{link.label}</span><span className="mt-1 block text-sm text-gray-500">{link.description}</span></span>
              <span aria-hidden="true" className="text-gray-400">→</span>
            </Link>
          ))}
        </div>
        <LogoutButton />
      </section>
      <MobileBottomNav role="restaurant" showOnDesktop />
    </main>
  );
}
