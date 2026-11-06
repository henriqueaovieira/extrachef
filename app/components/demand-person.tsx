'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import type { DemandPerson } from '@/lib/demand-detail';
import ProfessionalVerification from '@/app/components/professional-verification';

export default function DemandPersonSummary({ person, role, profileHref }: { person: DemandPerson; role?: string; profileHref?: string }) {
  const [failed, setFailed] = useState(false);
  const photo = <span className="relative grid size-12 shrink-0 place-items-center overflow-hidden rounded-full bg-orange-50 text-sm font-semibold text-orange-900">
    {person.photoUrl && !failed ? <Image src={person.photoUrl} alt={`Foto de ${person.name}`} fill unoptimized sizes="48px" className="object-cover" onError={() => setFailed(true)} /> : <span aria-hidden="true">{person.name.charAt(0).toUpperCase()}</span>}
  </span>;
  return (
    <div className="flex min-w-0 items-start gap-3">
      {profileHref ? <Link href={profileHref} aria-label={`Ver perfil de ${person.name}`}>{photo}</Link> : photo}
      <div className="min-w-0">
        <h3 className="flex items-center text-sm font-semibold text-gray-950"><span className="min-w-0 break-words">{person.name}</span><ProfessionalVerification userId={person.id} /></h3>
        <p className="mt-0.5 break-words text-xs text-gray-500">{person.specialties?.join(' · ') || role || 'Especialidade não compartilhada'}</p>
        <p className={`mt-2 text-xs ${person.completed_operations > 0 ? 'font-semibold text-emerald-800' : 'text-gray-600'}`}>
          {person.completed_operations > 0 ? `Já trabalhou com você · ${person.completed_operations} operações concluídas` : 'Sem operações concluídas com você.'}
        </p>
        <p className="mt-2 text-xs text-gray-600">Avaliação média {person.reputation?.average_rating != null || person.score != null
          ? `${Number(person.reputation?.average_rating ?? person.score).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} / 5` : 'não compartilhada'}</p>
        <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-gray-600">{person.experience || 'Experiência não compartilhada.'}</p>
        {person.reputation ? <div className="mt-2 space-y-1 text-xs text-gray-600">
          <p>{person.reputation.completed} trabalhos concluídos</p>
          <p className="font-semibold">Confiabilidade {Number(person.reputation.score).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} / 100 · {person.reputation.classification}</p>
          {person.reputation.punctuality !== null && <p>Pontualidade {Number(person.reputation.punctuality).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</p>}
        </div> : <p className="mt-2 text-xs text-gray-600">Operações: sem dados compartilhados</p>}
        {failed && <p role="alert" className="mt-1 text-xs text-red-700">Foto indisponível.</p>}
      </div>
    </div>
  );
}
