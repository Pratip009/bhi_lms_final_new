"use client";

import { useEffect, useRef, useState } from "react";
import { useFormCtx } from "./forms";

/** Draw-to-sign pad. Writes a PNG data URL into a hidden "signature" input. */
export function SignaturePad({ existing, defaultName }: { existing?: { name: string; signedAt: string } | null; defaultName: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [dataUrl, setDataUrl] = useState("");
  const [resign, setResign] = useState(!existing);
  const drawing = useRef(false);
  const { state } = useFormCtx();

  useEffect(() => {
    const c = canvas.current;
    if (!c || !resign) return;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio;
    c.height = c.offsetHeight * ratio;
    const ctx = c.getContext("2d")!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#1B2430";
  }, [resign]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const ctx = e.currentTarget.getContext("2d")!;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = e.currentTarget.getContext("2d")!;
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    setDataUrl(canvas.current!.toDataURL("image/png"));
  };
  const clear = () => {
    const c = canvas.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setDataUrl("");
  };

  if (!resign && existing) {
    return (
      <div className="rounded-md border border-pine-100 bg-pine-50 p-4 text-sm">
        <p>Signed by <strong>{existing.name}</strong> on {existing.signedAt}. If you change any answers, you'll be asked to sign again.</p>
        <button type="button" onClick={() => setResign(true)} className="mt-2 font-semibold text-pine-700 underline">Sign again</button>
      </div>
    );
  }

  const sigErr = state.fieldErrors?.signature;
  const nameErr = state.fieldErrors?.signerName;
  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1.5 text-sm font-medium">Signature <span className="text-brick-600">*</span></p>
        <canvas
          ref={canvas}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerLeave={up}
          className={`h-36 w-full touch-none rounded-md border-2 border-dashed bg-white ${sigErr ? "border-brick-600" : "border-line"}`}
          aria-label="Signature area. Draw your signature with a mouse, finger or stylus."
          role="img"
        />
        <div className="mt-1 flex justify-between text-xs">
          <span className={sigErr ? "font-medium text-brick-600" : "text-slate-500"}>{sigErr ?? "Draw your signature above"}</span>
          <button type="button" onClick={clear} className="font-semibold text-pine-700 underline">Clear</button>
        </div>
      </div>
      <input type="hidden" name="signature" value={dataUrl} />
      <div className="space-y-1.5">
        <label htmlFor="signerName" className="block text-sm font-medium">Type your full name <span className="text-brick-600">*</span></label>
        <input id="signerName" name="signerName" defaultValue={defaultName} maxLength={120}
          className="block w-full rounded-md border border-line px-3 py-2 focus:border-pine-600 focus:outline-none focus:ring-2 focus:ring-pine-100" />
        {nameErr && <p className="text-xs font-medium text-brick-600">{nameErr}</p>}
      </div>
    </div>
  );
}
