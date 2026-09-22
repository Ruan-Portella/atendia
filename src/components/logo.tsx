import Link from "next/link";

const brand = process.env.NEXT_PUBLIC_BRAND_NAME ?? "Atendia";

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-brand">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f6f4ee" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5h16v11H8l-4 4z" /></svg>
      </span>
      <span className="display text-[22px] font-bold">{brand}</span>
    </Link>
  );
}
