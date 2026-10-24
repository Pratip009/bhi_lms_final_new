import { Journey } from "@/components/journey";

export const dynamic = "force-dynamic";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[420px_1fr]">
      <aside className="hidden flex-col justify-between bg-pine-800 p-10 text-white lg:flex">
        <div>
          <p className="text-lg font-bold tracking-tight">BHI</p>
          <p className="mt-10 max-w-xs text-2xl font-semibold leading-snug">From application to your first class, in one place.</p>
        </div>
        <Journey current={0} tone="dark" />
        <p className="text-xs text-white/60">Hudson County,EQISS and private students</p>
      </aside>
      <main className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
