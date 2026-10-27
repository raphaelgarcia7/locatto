export function BrandLogo({ className = '' }: { className?: string }) {
  return (
    <img
      className={`brand-logo ${className}`.trim()}
      src="/locatto-logo.png"
      alt="Locatto · Locação para celebrar"
      width={2172}
      height={724}
      decoding="async"
    />
  );
}
