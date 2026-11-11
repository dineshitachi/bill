"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, ScanLine, Volume2 } from "lucide-react";

type Detector = { detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>> };
type DetectorConstructor = new (options?: { formats?: string[] }) => Detector;

declare global { interface Window { BarcodeDetector?: DetectorConstructor } }

export function BarcodeSvg({ value, width = 220, height = 64 }: { value: string; width?: number; height?: number }) {
  const bars = Array.from(value).flatMap((character, index) => {
    const seed = character.charCodeAt(0) + index * 17;
    return Array.from({ length: 7 }, (_, bit) => ((seed >> bit) & 1) === 1 ? 2 : 1);
  });
  const total = bars.reduce((sum, bar) => sum + bar, 0) || 1;
  let offset = 0;
  return <svg role="img" aria-label={`Barcode ${value}`} viewBox={`0 0 ${total} 64`} width={width} height={height} className="max-w-full"><rect width={total} height="64" fill="white" />{bars.map((bar, index) => { const x = offset; offset += bar; return index % 2 === 0 ? <rect key={index} x={x} y="4" width={bar} height="44" fill="black" /> : null; })}<text x={total / 2} y="59" textAnchor="middle" fontSize="8" fill="black">{value}</text></svg>;
}

export function BarcodeScanner({ onScan }: { onScan: (value: string) => void }) {
  const [value, setValue] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<Detector | null>(null);
  const cameraActive = useRef(false);
  function commit(raw: string) {
    const code = raw.trim(); if (!code) return;
    onScan(code); setValue("");
    try { const context = new AudioContext(); const oscillator = context.createOscillator(); const gain = context.createGain(); oscillator.frequency.value = 880; gain.gain.value = .04; oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + .06); } catch { /* scanner feedback is optional */ }
  }
  useEffect(() => () => { streamRef.current?.getTracks().forEach((track) => track.stop()); }, []);
  async function startCamera() {
    if (!window.BarcodeDetector || !navigator.mediaDevices?.getUserMedia) return;
    const detector = new window.BarcodeDetector({ formats: ["qr_code", "ean_13", "ean_8", "code_128", "upc_a", "upc_e"] }); detectorRef.current = detector;
    streamRef.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }); cameraActive.current = true; setCameraOpen(true);
    if (videoRef.current) videoRef.current.srcObject = streamRef.current;
    const scan = async () => { if (!videoRef.current || !detectorRef.current || !cameraActive.current) return; try { const results = await detectorRef.current.detect(videoRef.current); if (results[0]?.rawValue) commit(results[0].rawValue); } catch { /* frame may be unavailable */ } window.requestAnimationFrame(scan); };
    window.setTimeout(() => void scan(), 200);
  }
  function stopCamera() { cameraActive.current = false; streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null; detectorRef.current = null; setCameraOpen(false); }
  return <div className="rounded-xl border border-dashed border-[var(--line)] p-3"><div className="flex flex-wrap items-center gap-2"><ScanLine size={16} className="text-[var(--accent)]" /><input className="field min-w-[180px] flex-1 !py-2" autoComplete="off" inputMode="none" aria-label="Scan barcode or QR code" placeholder="Scan SKU / barcode and press Enter" value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit(value); } }} /><button type="button" className="button button-soft !px-3 !py-2 text-xs" onClick={() => cameraOpen ? stopCamera() : void startCamera()}><Camera size={14} /> {cameraOpen ? "Stop camera" : "Camera"}</button><span className="muted flex items-center gap-1 text-xs"><Volume2 size={13} /> Scan feedback on</span></div>{cameraOpen && <video ref={videoRef} autoPlay muted playsInline className="mt-3 max-h-48 w-full rounded-lg bg-slate-950 object-cover" />}</div>;
}
