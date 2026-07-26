import type { ReactNode } from 'react';

export interface CardProps {
  children: ReactNode;
  className?: string;
  flush?: boolean;
}

export function Card({ children, className, flush }: CardProps) {
  const cls = ['card', flush ? 'card--flush' : '', className ?? ''].filter(Boolean).join(' ');
  return <div className={cls}>{children}</div>;
}

export interface CardHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
}

export function CardHeader({ title, description, actions }: CardHeaderProps) {
  return (
    <div className="card__header">
      <div>
        <h2 className="card__title">{title}</h2>
        {description ? <p className="card__desc">{description}</p> : null}
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </div>
  );
}

export interface CardSectionProps {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

export function CardSection({ title, description, children, className }: CardSectionProps) {
  return (
    <section className={['section-block', className ?? ''].filter(Boolean).join(' ')}>
      {title ? <h3 className="section-block__title">{title}</h3> : null}
      {description ? <p className="section-block__desc">{description}</p> : null}
      {children}
    </section>
  );
}
