import Link from "next/link";

type BrandLockupProps = {
  href: string;
  ariaLabel: string;
  className?: string;
  showStudio?: boolean;
  compact?: boolean;
};

/** Shared MoZhou wordmark used by public, auth, navigation, and writing surfaces. */
export function BrandLockup({
  href,
  ariaLabel,
  className = "",
  showStudio = false,
  compact = false,
}: BrandLockupProps) {
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      data-compact={compact ? "true" : undefined}
      className={`mz-brand-lockup ${className}`.trim()}
    >
      <span className="mz-brand-mark" aria-hidden="true">墨</span>
      <span className="mz-brand-name">墨舟</span>
      {showStudio && <span className="mz-brand-meta">STUDIO</span>}
    </Link>
  );
}
