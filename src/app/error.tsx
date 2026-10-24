"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto max-w-md px-6 py-24 text-center">
      <h1 className="text-2xl font-semibold">This page couldn't load</h1>
      <p className="mt-2 text-slate-600">Try again. If it keeps happening, contact the office.</p>
      <button onClick={reset} className="mt-6 rounded-md bg-pine-700 px-4 py-2 text-sm font-semibold text-white">Try again</button>
    </main>
  );
}
