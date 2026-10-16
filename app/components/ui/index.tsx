'use client';

import { useId, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { formatInput } from '@/lib/ui/input-masks';

function classes(...values: Array<string | undefined | false>) {
  return values.filter(Boolean).join(' ');
}

export function Button({ className, variant = 'secondary', busy, children, disabled, type = 'button', ...props }: ComponentProps<'button'> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  busy?: boolean;
}) {
  return (
    <button {...props} type={type} disabled={disabled || busy} aria-busy={busy || undefined}
      className={classes('ec-button', `ec-button--${variant}`, className)}>
      {busy && <span className="ec-spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function TextInput({ className, type = 'text', ...props }: ComponentProps<'input'>) {
  return <input {...props} type={type} className={classes(
    type === 'checkbox' || type === 'radio' ? 'ec-choice' : 'ec-control', className,
  )} />;
}

export function PasswordInput({ className, id, ...props }: Omit<ComponentProps<'input'>, 'type'>) {
  const [visible, setVisible] = useState(false);
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return (
    <div className="ec-password">
      <TextInput {...props} id={inputId} type={visible ? 'text' : 'password'}
        className={classes('ec-password__input', className)} />
      <Button variant="ghost" className="ec-password__toggle" disabled={props.disabled}
        aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'} aria-controls={inputId}
        aria-pressed={visible} onClick={() => setVisible((current) => !current)}>
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
          {visible && <path d="m3 3 18 18" />}
        </svg>
      </Button>
    </div>
  );
}

export function TextArea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea {...props} className={classes('ec-control ec-textarea', className)} />;
}

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select {...props} className={classes('ec-control', className)} />;
}

export function Card({ className, as: Element = 'section', ...props }: Omit<ComponentProps<'section'>, 'ref'> & {
  as?: 'section' | 'article' | 'div';
}) {
  return <Element {...props} className={classes('ec-card', className)} />;
}

export function Badge({ className, tone = 'neutral', ...props }: ComponentProps<'span'> & {
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}) {
  return <span {...props} className={classes('ec-badge', `ec-badge--${tone}`, className)} />;
}

export function Toast({ children, title, tone = 'success', className, onDismiss, ...props }: Omit<ComponentProps<'div'>, 'title'> & {
  title?: string;
  tone?: 'success' | 'error' | 'info';
  onDismiss?: () => void;
}) {
  return (
    <div {...props} role={tone === 'error' ? 'alert' : 'status'} aria-atomic="true"
      className={classes('ec-toast', `ec-toast--${tone}`, className)}>
      <span className="ec-toast__icon" aria-hidden="true">{tone === 'success' ? '✓' : tone === 'error' ? '!' : 'i'}</span>
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        <div className="break-words text-sm leading-6">{children}</div>
      </div>
      {onDismiss && <Button variant="ghost" aria-label="Fechar aviso" onClick={onDismiss}>×</Button>}
    </div>
  );
}

export function EmptyState({ title, description, icon = '◇', action }: {
  title: string;
  description: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Card className="ec-empty">
      <span className="ec-empty__icon" aria-hidden="true">{icon}</span>
      <h2 className="text-lg font-semibold text-gray-950">{title}</h2>
      <p className="mx-auto max-w-sm text-sm leading-6 text-gray-600">{description}</p>
      {action && <div className="mt-2">{action}</div>}
    </Card>
  );
}

export function LoadingSkeleton({ label = 'Carregando conteúdo', className }: { label?: string; className?: string }) {
  return (
    <div role="status" aria-busy="true" className={classes('ec-skeleton', className)}>
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="space-y-4">
        <div className="ec-skeleton__line w-2/5" />
        <div className="ec-skeleton__line w-full" />
        <div className="ec-skeleton__line w-4/5" />
      </div>
    </div>
  );
}

export type InputMask = 'cpf' | 'cnpj' | 'phone' | 'postal-code';

export function MaskedInput({ mask, value, onValueChange, ...props }: Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'type'> & {
  mask: InputMask;
  value: string;
  onValueChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <TextInput {...props} ref={inputRef} type={mask === 'phone' ? 'tel' : 'text'}
      inputMode={mask === 'phone' ? 'tel' : 'numeric'} value={formatInput(value, mask)}
      onChange={(event) => {
        const input = event.currentTarget;
        const position = input.selectionStart ?? input.value.length;
        const digitsBefore = input.value.slice(0, position).replace(/\D/g, '').length;
        const formatted = formatInput(input.value, mask);
        onValueChange(formatted);
        requestAnimationFrame(() => {
          if (inputRef.current !== input || document.activeElement !== input) return;
          let cursor = 0;
          let digits = 0;
          while (cursor < formatted.length && digits < digitsBefore) {
            if (/\d/.test(formatted[cursor])) digits++;
            cursor++;
          }
          input.setSelectionRange(cursor, cursor);
        });
      }} />
  );
}
