import { useId } from 'react';
import { Badge, Card } from '@/app/components/ui';
import type { getProfileProgress } from '@/lib/ui/profile-progress';

export default function ProfileProgress({ progress }: { progress: ReturnType<typeof getProfileProgress> }) {
  const headingId = useId();
  return (
    <Card aria-labelledby={headingId} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="font-semibold text-gray-950">Seu perfil</h2>
        <Badge tone={progress.percentage === 100 ? 'success' : 'neutral'}>{progress.percentage}% preenchido</Badge>
      </div>
      <progress className="ec-progress" max={100} value={progress.percentage} aria-label="Preenchimento do perfil" />
      <ul className="grid grid-cols-2 gap-2 text-sm text-gray-700 sm:grid-cols-3">
        {progress.items.map((item) => (
          <li key={item.label} className="flex items-center gap-2">
            <span aria-hidden="true" className={item.complete ? 'text-emerald-700' : 'text-gray-500'}>{item.complete ? '✓' : '○'}</span>
            <span><span className="sr-only">{item.complete ? 'Preenchido: ' : 'Falta: '}</span>{item.label}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs leading-5 text-gray-600">Indicador de preenchimento. Não representa verificação ou aprovação dos documentos.</p>
    </Card>
  );
}
