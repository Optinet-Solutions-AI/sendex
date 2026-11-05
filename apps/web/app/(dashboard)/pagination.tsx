import Link from "next/link";
import { formatNumber } from "../../lib/format";

/** Server-rendered "Showing x–y of n" with Previous / Next links; `href(page)` builds the URL. */
export function Pagination({
  page,
  pageSize,
  total,
  href,
}: {
  page: number;
  pageSize: number;
  total: number;
  href: (page: number) => string;
}) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const link =
    "inline-flex h-8 items-center rounded-md border border-neutral-300 bg-white px-3 text-xs font-medium hover:bg-neutral-100";
  const disabled = `${link} pointer-events-none opacity-50`;
  return (
    <nav
      aria-label="Pagination"
      className="mt-3 flex items-center justify-between text-sm text-neutral-600"
    >
      <span>
        Showing {formatNumber(from)}–{formatNumber(to)} of {formatNumber(total)}
      </span>
      <div className="flex items-center gap-2">
        <Link
          href={href(page - 1)}
          className={page <= 1 ? disabled : link}
          aria-disabled={page <= 1}
        >
          Previous
        </Link>
        <span>
          Page {page} of {pages}
        </span>
        <Link
          href={href(page + 1)}
          className={page >= pages ? disabled : link}
          aria-disabled={page >= pages}
        >
          Next
        </Link>
      </div>
    </nav>
  );
}
