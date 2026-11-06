import Link from "next/link";

/** Bull Street mark: a share (left) fully matched by its pledge (right). */
export function Mark({ size = 26, dark = false }: { size?: number; dark?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden>
      <rect width="28" height="28" rx="8" fill={dark ? "#5fcbd9" : "#0f6b7d"} />
      <rect x="7" y="7" width="6" height="14" rx="2" fill={dark ? "#0b0d10" : "#fff"} />
      <rect x="15" y="7" width="6" height="14" rx="2" fill="none" stroke={dark ? "#0b0d10" : "#fff"} strokeWidth="1.8" />
    </svg>
  );
}

export function Wordmark({ href = "/", dark = false }: { href?: string; dark?: boolean }) {
  return (
    <Link href={href} className={`flex items-center gap-2.5 ${dark ? "text-on-dark" : "text-ink"}`} aria-label="Bull Street home">
      <Mark dark={dark} />
      <span className="text-[17px] font-semibold tracking-[-0.02em]">Bull Street</span>
    </Link>
  );
}
