export function renderBarcodeSvg(value: string): string {
  const bars = Array.from(value).flatMap((character, index) => { const seed = character.charCodeAt(0) + index * 17; return Array.from({ length: 7 }, (_, bit) => ((seed >> bit) & 1) === 1 ? 2 : 1); });
  const total = bars.reduce((sum, bar) => sum + bar, 0) || 1; let offset = 0;
  const rects = bars.map((bar, index) => { const x = offset; offset += bar; return index % 2 === 0 ? `<rect x="${x}" y="4" width="${bar}" height="44" fill="black"/>` : ""; }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Barcode ${value}" viewBox="0 0 ${total} 64" width="320" height="64"><rect width="${total}" height="64" fill="white"/>${rects}<text x="${total / 2}" y="59" text-anchor="middle" font-size="8">${value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</text></svg>`;
}
