'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import type { DemandPerson } from '@/lib/demand-detail';

export default function DemandPersonSummary({ person, role, profileHref }: { person: DemandPerson; role?: string; profileHref?: string }) {
  const [failed, setFailed] = useState(false);
  const photo = <span className="relative grid size-12 shrink-0 place-items-center overflow-hidden rounded-full bg-orange-50 text-sm font-semibold text-orange-900">
    {person.photoUrl && !failed ? <Image src={person.photoUrl} alt={`Foto de ${person.name}`} fill unoptimized sizes="48px" className="object-cover" onError={() => setFailed(true)} /> : <span aria-hidden="true">{person.name.charAt(0).toUpperCase()}</span>}
  </span>;
  return (
    <div className="flex min-w-0 items-start gap-3">
      {profileHref ? <Link href={profileHref} aria-label={`Ver perfil de ${person.name}`}>{photo}</Link> : photo}
      <div className="min-w-0">
        <h3 className="break-words text-sm font-semibold text-gray-950">{person.name}</h3>
        <p className="mt-0.5 break-words text-xs text-gray-500">{person.specialties?.join(' · ') || role || 'Especialidade não compartilhada'}</p>
        {person.reputation ? <div className="mt-2 space-y-1 text-xs text-gray-600">
          <p className="font-semibold">Confiabilidade {Number(person.reputation.score).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} / 100 · {person.reputation.classification}</p>
          {person.reputation.punctuality !== null && <p>Pontualidade {Number(person.reputation.punctuality).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</p>}
          <p>{person.reputation.completed} trabalhos concluídos</p>
        </div> : person.score !== null ? <p className="mt-1 text-xs text-gray-600">Avaliação média {Number(person.score).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} / 5</p> : null}
        {person.completed_operations > 0 && <p className="mt-2 text-xs font-semibold text-emerald-800">Já trabalhou com você</p>}
        {failed && <p role="status" className="mt-1 text-xs text-red-700">Foto indisponível.</p>}
      </div>
    </div>
  );
}
