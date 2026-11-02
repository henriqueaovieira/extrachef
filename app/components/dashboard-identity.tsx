import Image from 'next/image';
import Link from 'next/link';

type DashboardRole = 'restaurant' | 'worker';

export function DashboardLogo({ role }: { role?: DashboardRole }) {
  return (
    <Link href={role ? `/${role}/dashboard` : '/'} className="text-lg font-bold tracking-[-0.06em]" aria-label="ExtraChef — Home">
      extra<span className="text-orange-700">chef</span><span className="text-orange-700">.</span>
    </Link>
  );
}

export function DashboardAvatar({
  role,
  name,
  photoUrl,
  onImageError,
}: {
  role: DashboardRole;
  name: string;
  photoUrl: string | null;
  onImageError: () => void;
}) {
  return (
    <Link
      href={role === 'worker' ? '/worker/profile/details' : '/restaurant/profile'}
      aria-label="Meu perfil"
      className="relative grid size-11 shrink-0 place-items-center overflow-hidden rounded-full bg-orange-50 text-sm font-semibold text-orange-900 ring-1 ring-black/5"
    >
      {photoUrl ? (
        <Image
          src={photoUrl}
          alt={role === 'restaurant' ? 'Logo do restaurante' : 'Foto do profissional'}
          fill
          unoptimized
          sizes="44px"
          className="object-cover"
          onError={onImageError}
        />
      ) : (
        <span aria-hidden="true">{name.charAt(0).toUpperCase() || (role === 'restaurant' ? 'E' : 'P')}</span>
      )}
    </Link>
  );
}
