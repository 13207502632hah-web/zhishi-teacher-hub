import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  ReactNode,
} from "react";

const joinClassNames = (...values: Array<string | false | null | undefined>) =>
  values.filter(Boolean).join(" ");

type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

export function Button({
  className,
  type = "button",
  variant = "primary",
  ...props
}: ButtonProps) {
  return (
    <button
      className={joinClassNames("zs-button", `zs-button--${variant}`, className)}
      type={type}
      {...props}
    />
  );
}

type PanelProps = HTMLAttributes<HTMLElement> & {
  actions?: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  title?: ReactNode;
};

export function Panel({
  actions,
  children,
  className,
  description,
  eyebrow,
  title,
  ...props
}: PanelProps) {
  return (
    <section className={joinClassNames("zs-panel", className)} {...props}>
      {(eyebrow || title || description || actions) && (
        <header className="zs-panel__header">
          <div>
            {eyebrow && <p className="zs-eyebrow">{eyebrow}</p>}
            {title && <h2>{title}</h2>}
            {description && <p className="zs-panel__description">{description}</p>}
          </div>
          {actions && <div className="zs-panel__actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

type MetricCardProps = HTMLAttributes<HTMLElement> & {
  detail?: ReactNode;
  label: ReactNode;
  trend?: ReactNode;
  value: ReactNode;
};

export function MetricCard({
  className,
  detail,
  label,
  trend,
  value,
  ...props
}: MetricCardProps) {
  return (
    <article className={joinClassNames("zs-metric", className)} {...props}>
      <span>{label}</span>
      <strong>{value}</strong>
      {(detail || trend) && (
        <footer>
          {detail && <small>{detail}</small>}
          {trend && <em>{trend}</em>}
        </footer>
      )}
    </article>
  );
}

type StatusTone = "neutral" | "success" | "warning" | "danger" | "info";

type StatusBadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: StatusTone;
};

export function StatusBadge({
  className,
  tone = "neutral",
  ...props
}: StatusBadgeProps) {
  return (
    <span
      className={joinClassNames("zs-status", `zs-status--${tone}`, className)}
      {...props}
    />
  );
}

type EmptyStateProps = HTMLAttributes<HTMLDivElement> & {
  action?: ReactNode;
  description: ReactNode;
  icon?: ReactNode;
  title: ReactNode;
};

export function EmptyState({
  action,
  className,
  description,
  icon = "知",
  title,
  ...props
}: EmptyStateProps) {
  return (
    <div className={joinClassNames("zs-empty", className)} {...props}>
      <span className="zs-empty__mark" aria-hidden="true">{icon}</span>
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      {action && <div className="zs-empty__action">{action}</div>}
    </div>
  );
}

const teachingLoopStages = ["备课", "上课", "作业", "反馈", "结算"] as const;

type TeachingLoopStage = (typeof teachingLoopStages)[number];

type TeachingLoopTrackProps = HTMLAttributes<HTMLOListElement> & {
  activeStage?: TeachingLoopStage;
};

export function TeachingLoopTrack({
  activeStage = "备课",
  className,
  ...props
}: TeachingLoopTrackProps) {
  const activeIndex = teachingLoopStages.indexOf(activeStage);

  return (
    <ol
      aria-label="教学闭环进度"
      className={joinClassNames("zs-teaching-loop", className)}
      {...props}
    >
      {teachingLoopStages.map((stage, index) => {
        const state = index < activeIndex ? "complete" : index === activeIndex ? "current" : "upcoming";
        return (
          <li
            aria-current={state === "current" ? "step" : undefined}
            data-state={state}
            key={stage}
          >
            <span>{index + 1}</span>
            <strong>{stage}</strong>
          </li>
        );
      })}
    </ol>
  );
}
