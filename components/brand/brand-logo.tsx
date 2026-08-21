import Image from "next/image";

export function BrandLogo({
  size = 24,
  label = "Jimmy GM",
  className = "",
  wordmarkClassName = "",
}: {
  size?: number;
  label?: string;
  className?: string;
  wordmarkClassName?: string;
}) {
  return <span className={`inline-flex items-center gap-2 ${className}`}>
    <Image src="/brand/jimmygm-mark.svg" alt="" aria-hidden="true" width={size} height={size} className="shrink-0" />
    <span className={wordmarkClassName}>{label}</span>
  </span>;
}
