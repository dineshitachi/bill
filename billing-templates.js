(function (root) {
  const names = [
    "Aurora", "Ledger", "Minimal", "Slate", "Mint", "Indigo", "Studio", "Classic", "Grid", "Modern",
    "Mono", "Copper", "Horizon", "Retail", "Pro", "Bold", "Compact", "Elegant", "Prime", "Signature",
    "Coastal", "Heritage", "Ember", "Orchard", "Metro", "Luxe", "Nordic", "Spectrum", "Blueprint", "Terra",
  ];
  const palettes = [
    ["#5543d1", "#f5f3ff"], ["#0f766e", "#f0fdfa"], ["#475569", "#f8fafc"], ["#1d4ed8", "#eff6ff"],
    ["#047857", "#ecfdf5"], ["#4338ca", "#eef2ff"], ["#be123c", "#fff1f2"], ["#92400e", "#fffbeb"],
    ["#0369a1", "#f0f9ff"], ["#c2410c", "#fff7ed"], ["#111827", "#f9fafb"], ["#9a3412", "#fff7ed"],
    ["#1e40af", "#eff6ff"], ["#a21caf", "#fdf4ff"], ["#4f46e5", "#eef2ff"], ["#b91c1c", "#fef2f2"],
    ["#334155", "#f1f5f9"], ["#6d28d9", "#f5f3ff"], ["#166534", "#f0fdf4"], ["#14532d", "#f0fdf4"],
    ["#0e7490", "#ecfeff"], ["#7c2d12", "#fff7ed"], ["#9f1239", "#fff1f2"], ["#4d7c0f", "#f7fee7"],
    ["#1e3a8a", "#eff6ff"], ["#854d0e", "#fefce8"], ["#1f2937", "#f8fafc"], ["#7e22ce", "#faf5ff"],
    ["#312e81", "#eef2ff"], ["#78350f", "#fffbeb"],
  ];
  const layouts = ["band", "classic", "minimal", "frame", "ledger", "split", "ribbon", "compact", "soft", "bold"];
  const logoPlacements = ["left", "center", "right"];

  if (names.length !== 30 || palettes.length !== names.length) {
    throw new Error("The billing template catalog must contain exactly 30 templates.");
  }

  const templates = Object.freeze(names.map((name, index) => {
    const layout = layouts[index % layouts.length];
    return Object.freeze({
      id: name.toLowerCase(),
      name,
      accent: palettes[index][0],
      surface: palettes[index][1],
      layout,
      logoPlacement: logoPlacements[index % logoPlacements.length],
      font: layout === "classic"
        ? "Georgia, serif"
        : layout === "ledger"
          ? "ui-monospace, SFMono-Regular, Consolas, monospace"
          : "system-ui, sans-serif",
    });
  }));

  if (root) root.BillingTemplates = templates;
  if (typeof module !== "undefined" && module.exports) module.exports = templates;
})(typeof globalThis !== "undefined" ? globalThis : this);
