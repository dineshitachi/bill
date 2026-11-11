"use client";

import { useRef, useState, type DragEvent } from "react";
import { ImagePlus, Trash2, Upload } from "lucide-react";
import { isCompanyLogoDataUrl } from "@/logo";

const maxSourceFileSize = 5 * 1024 * 1024;
const maxOutputBlobSize = 175 * 1024;
const maxLogoWidth = 720;
const maxLogoHeight = 240;

function blobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("The resized logo could not be read."));
        return;
      }
      resolve(reader.result);
    };
    reader.onerror = () => reject(reader.error || new Error("The resized logo could not be read."));
    reader.readAsDataURL(blob);
  });
}

async function resizeLogo(file: File): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    throw new Error("Choose a PNG, JPEG, or WebP logo.");
  }
  if (!file.size || file.size > maxSourceFileSize) {
    throw new Error("The original logo must be smaller than 5 MB.");
  }

  const image = await createImageBitmap(file);
  try {
    if (image.width > 12_000 || image.height > 12_000) {
      throw new Error("The logo dimensions are too large to process.");
    }
    const fitScale = Math.min(maxLogoWidth / image.width, maxLogoHeight / image.height, 1);
    let scale = fitScale;
    let quality = 0.88;

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("This browser cannot resize the logo.");
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", quality));
      if (!blob) throw new Error("The logo could not be resized in this browser.");
      if (blob.size <= maxOutputBlobSize) {
        const dataUrl = await blobAsDataUrl(blob);
        if (isCompanyLogoDataUrl(dataUrl)) return dataUrl;
        throw new Error("The resized logo format is not supported.");
      }

      if (quality > 0.55) quality -= 0.1;
      else {
        scale *= 0.82;
        quality = 0.82;
      }
    }
  } finally {
    image.close();
  }
  throw new Error("The logo could not be compressed enough. Choose a simpler image.");
}

export function CompanyLogoUpload({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError("");
    setBusy(true);
    try {
      onChange(await resizeLogo(file));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The logo could not be processed.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    void handleFile(event.dataTransfer.files[0]);
  }

  return (
    <div className="space-y-3">
      <label
        className={`flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-5 text-center transition ${dragging ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--line)] bg-white/55 hover:border-[var(--accent)]"}`}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <input
          ref={inputRef}
          className="sr-only"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(event) => void handleFile(event.currentTarget.files?.[0])}
        />
        {value
          ? <img src={value} alt="Company logo preview" className="h-16 max-w-full object-contain" />
          : <ImagePlus size={28} className="text-[var(--accent)]" />}
        <span className="font-semibold">{busy ? "Resizing logo…" : value ? "Drop a replacement logo or browse" : "Drop your company logo here or browse"}</span>
        <span className="muted text-xs">PNG, JPEG, or WebP · maximum 5 MB. Resized to fit the invoice header.</span>
      </label>
      {error && <p className="text-sm text-rose-700" role="alert">{error}</p>}
      {value && !busy && <div className="flex items-center justify-between rounded-xl bg-white/60 px-3 py-2">
        <span className="muted flex items-center gap-2 text-xs"><Upload size={14} /> Preview scaled to a fixed invoice-header area</span>
        <button type="button" className="button button-quiet !px-2 !py-1 text-xs" onClick={() => { onChange(""); setError(""); }}>
          <Trash2 size={14} /> Remove
        </button>
      </div>}
    </div>
  );
}
