/** The printed text of an enrollment form. Short lines without a full stop are shown as headings. */
export function FormBody({ paragraphs, className }: { paragraphs: string[]; className?: string }) {
  if (!paragraphs.length) return null;
  return (
    <div className={className ?? "mb-6 max-w-3xl space-y-3 text-sm leading-relaxed text-slate-800"}>
      {paragraphs.map((p, i) => {
        const heading = p.length < 60 && !p.includes("\n") && !/[.:]$/.test(p.trim()) && !p.includes("·");
        return heading ? <p key={i} className="pt-1 font-semibold text-ink">{p}</p> : <p key={i} className="whitespace-pre-wrap">{p}</p>;
      })}
    </div>
  );
}
