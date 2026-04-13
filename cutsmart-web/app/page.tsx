import Link from "next/link";

export default function HomePage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg-app)] px-4">
      <div className="w-full max-w-xl rounded-[16px] border border-[var(--panel-border)] bg-white p-8 shadow-sm">
        <p className="text-xs uppercase tracking-[0.28em] text-[var(--text-muted)]">CutSmart</p>
        <h1 className="mt-2 text-3xl font-bold text-[var(--text-main)]">Web Workspace</h1>
        <p className="mt-3 text-sm text-[var(--text-muted)]">
          Open your CutSmart workspace and continue with dashboard, project details, sales, and cutlist workflows.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/login"
            className="inline-flex h-10 items-center rounded-[10px] border border-[var(--brand)] bg-[var(--brand)] px-4 text-sm font-bold text-white transition hover:border-[var(--brand-strong)] hover:bg-[var(--brand-strong)]"
          >
            Go to Login
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex h-10 items-center rounded-[10px] border border-[var(--panel-border)] bg-white px-4 text-sm font-bold text-[#475467] transition hover:bg-[var(--panel-muted)]"
          >
            Open Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
