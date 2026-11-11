"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, RotateCcw, Send, Warehouse as WarehouseIcon } from "lucide-react";

type Warehouse = { id: string; name: string; code: string; address: string };
type Product = { id: string; name: string; sku: string; unit: string };
type StockRow = { warehouseId: string; productId: string; productName: string; sku: string; unit: string; quantity: string };
type Transfer = { id: string; number: string; sourceWarehouseId: string; sourceName: string; targetWarehouseId: string; targetName: string; status: string; createdBy: string; createdAt: string; receivedBy: string | null; receivedAt: string | null; freightCost: string; freightBasis: "QUANTITY" | "CATALOG_VALUE" };
type TransferItem = { transferId: string; productId: string; productName: string; sku: string; unit: string; quantity: string; allocatedFreight: string };
type WarehouseData = { warehouses: Warehouse[]; products: Product[]; stock: StockRow[]; transfers: Transfer[]; transferItems: TransferItem[] };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers } });
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : `Request failed (${response.status})`);
  return body as T;
}

export function WarehouseTransferView({ canManage }: { canManage: boolean }) {
  const [data, setData] = useState<WarehouseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [warehouseDraft, setWarehouseDraft] = useState({ name: "", code: "", address: "" });
  const [stockDraft, setStockDraft] = useState({ warehouseId: "", productId: "", quantity: "" });
  const [transferDraft, setTransferDraft] = useState({ sourceWarehouseId: "", targetWarehouseId: "", freightCost: "0", freightBasis: "QUANTITY" as "QUANTITY" | "CATALOG_VALUE", items: [{ productId: "", quantity: "" }] });

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setData(await request<WarehouseData>("/api/warehouses")); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Warehouse data could not be loaded"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function submit(action: () => Promise<unknown>) {
    setBusy(true); setError("");
    try { await action(); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Warehouse action failed"); }
    finally { setBusy(false); }
  }

  const warehouses = data?.warehouses || [];
  const products = data?.products || [];
  const transfers = data?.transfers || [];

  return <section className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><p className="eyebrow">Modules 101 & 701</p><h2 className="mt-1 text-2xl font-bold">Warehouses & transfers</h2><p className="muted mt-1 max-w-3xl text-sm">Location-level stock, freight-aware transfer challans, and goods in transit.</p></div>
      <button className="button button-primary" onClick={() => void load()} disabled={loading}><RotateCcw size={16} /> {loading ? "Updating..." : "Refresh"}</button>
    </div>
    {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}

    {canManage && <div className="grid gap-5 xl:grid-cols-3">
      <section className="panel content-card">
        <h3 className="font-bold">Add godown</h3>
        <form className="mt-3 space-y-3" onSubmit={(event) => { event.preventDefault(); void submit(async () => { await request("/api/warehouses", { method: "POST", body: JSON.stringify(warehouseDraft) }); setWarehouseDraft({ name: "", code: "", address: "" }); }); }}>
          <label className="block"><span className="field-label">Name</span><input className="field" required maxLength={120} value={warehouseDraft.name} onChange={(event) => setWarehouseDraft({ ...warehouseDraft, name: event.target.value })} /></label>
          <label className="block"><span className="field-label">Code</span><input className="field" required maxLength={24} value={warehouseDraft.code} onChange={(event) => setWarehouseDraft({ ...warehouseDraft, code: event.target.value.toUpperCase() })} /></label>
          <label className="block"><span className="field-label">Address</span><input className="field" maxLength={500} value={warehouseDraft.address} onChange={(event) => setWarehouseDraft({ ...warehouseDraft, address: event.target.value })} /></label>
          <button className="button button-soft" disabled={busy}><Plus size={15} /> Add location</button>
        </form>
      </section>

      <section className="panel content-card">
        <h3 className="font-bold">Set location balance</h3>
        <form className="mt-3 space-y-3" onSubmit={(event) => { event.preventDefault(); void submit(async () => { await request("/api/warehouses/stock", { method: "POST", body: JSON.stringify({ ...stockDraft, mode: "SET", quantity: Number(stockDraft.quantity) }) }); setStockDraft({ ...stockDraft, quantity: "" }); }); }}>
          <label className="block"><span className="field-label">Location</span><select className="field" required value={stockDraft.warehouseId} onChange={(event) => setStockDraft({ ...stockDraft, warehouseId: event.target.value })}><option value="">Select location</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name} · {warehouse.code}</option>)}</select></label>
          <label className="block"><span className="field-label">Product</span><select className="field" required value={stockDraft.productId} onChange={(event) => setStockDraft({ ...stockDraft, productId: event.target.value })}><option value="">Select product</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.sku}</option>)}</select></label>
          <label className="block"><span className="field-label">Physical quantity</span><input className="field" type="number" min="0" step="0.001" required value={stockDraft.quantity} onChange={(event) => setStockDraft({ ...stockDraft, quantity: event.target.value })} /></label>
          <button className="button button-soft" disabled={busy || !warehouses.length}><WarehouseIcon size={15} /> Save location balance</button>
        </form>
      </section>

      <section className="panel content-card">
        <h3 className="font-bold">Create transfer challan</h3>
        <form className="mt-3 space-y-3" onSubmit={(event) => { event.preventDefault(); void submit(async () => { await request("/api/warehouse-transfers", { method: "POST", body: JSON.stringify({ ...transferDraft, freightCost: Number(transferDraft.freightCost), items: transferDraft.items.map((item) => ({ productId: item.productId, quantity: Number(item.quantity) })) }) }); setTransferDraft({ ...transferDraft, freightCost: "0", items: [{ productId: "", quantity: "" }] }); }); }}>
          <label className="block"><span className="field-label">From</span><select className="field" required value={transferDraft.sourceWarehouseId} onChange={(event) => setTransferDraft({ ...transferDraft, sourceWarehouseId: event.target.value })}><option value="">Source location</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>
          <label className="block"><span className="field-label">To</span><select className="field" required value={transferDraft.targetWarehouseId} onChange={(event) => setTransferDraft({ ...transferDraft, targetWarehouseId: event.target.value })}><option value="">Destination location</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>
          <div className="grid gap-2 sm:grid-cols-2"><label className="block"><span className="field-label">Freight cost</span><input className="field" type="number" min="0" step="0.01" required value={transferDraft.freightCost} onChange={(event) => setTransferDraft({ ...transferDraft, freightCost: event.target.value })} /></label><label className="block"><span className="field-label">Allocation basis</span><select className="field" value={transferDraft.freightBasis} onChange={(event) => setTransferDraft({ ...transferDraft, freightBasis: event.target.value as "QUANTITY" | "CATALOG_VALUE" })}><option value="QUANTITY">Quantity share</option><option value="CATALOG_VALUE">Catalog value share</option></select></label></div>
          <p className="muted text-xs">Catalog-value allocation uses current selling price as a proxy, not acquisition cost. Freight is recorded on the challan and is not posted to the financial ledger.</p>
          {transferDraft.items.map((item, index) => <div className="grid grid-cols-[minmax(0,1fr)_6rem_auto] gap-2" key={index}>
            <select className="field min-w-0" required value={item.productId} aria-label={`Transfer product ${index + 1}`} onChange={(event) => setTransferDraft({ ...transferDraft, items: transferDraft.items.map((entry, row) => row === index ? { ...entry, productId: event.target.value } : entry) })}><option value="">Product</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select>
            <input className="field" type="number" min="0.001" step="0.001" required placeholder="Qty" aria-label={`Transfer quantity ${index + 1}`} value={item.quantity} onChange={(event) => setTransferDraft({ ...transferDraft, items: transferDraft.items.map((entry, row) => row === index ? { ...entry, quantity: event.target.value } : entry) })} />
            <button type="button" className="button button-quiet !px-2" aria-label="Remove transfer line" disabled={transferDraft.items.length === 1} onClick={() => setTransferDraft({ ...transferDraft, items: transferDraft.items.filter((_, row) => row !== index) })}>×</button>
          </div>)}
          <div className="flex flex-wrap gap-2"><button type="button" className="button button-quiet" onClick={() => setTransferDraft({ ...transferDraft, items: [...transferDraft.items, { productId: "", quantity: "" }] })}><Plus size={15} /> Add item</button><button className="button button-primary" disabled={busy || warehouses.length < 2}><Send size={15} /> Dispatch</button></div>
        </form>
      </section>
    </div>}

    <section className="panel content-card">
      <div className="border-b border-[var(--line)] p-4"><h3 className="font-bold">Stock by location</h3></div>
      {data?.stock.length ? <div className="table-wrap"><table className="simple-table"><thead><tr className="table-row"><th>Location</th><th>SKU</th><th>Item</th><th>Quantity</th></tr></thead><tbody>{data.stock.map((row) => <tr className="table-row" key={`${row.warehouseId}-${row.productId}`}><td>{warehouses.find((warehouse) => warehouse.id === row.warehouseId)?.name || "Location"}</td><td>{row.sku}</td><td className="font-semibold">{row.productName}</td><td>{Number(row.quantity).toLocaleString()} {row.unit}</td></tr>)}</tbody></table></div> : <p className="muted p-5 text-sm">{loading ? "Loading location balances..." : "No warehouse stock has been set up."}</p>}
    </section>

    <section className="panel content-card">
          <div className="border-b border-[var(--line)] p-4"><h3 className="font-bold">Transfer challans</h3></div>
      {transfers.length ? <div className="table-wrap"><table className="simple-table"><thead><tr className="table-row"><th>Challan</th><th>Route</th><th>Items & freight split</th><th>Total freight</th><th>Status</th><th>Dispatched</th><th></th></tr></thead><tbody>{transfers.map((transfer) => {
        const items = (data?.transferItems || []).filter((item) => item.transferId === transfer.id);
        return <tr className="table-row" key={transfer.id}><td className="font-semibold">{transfer.number}</td><td>{transfer.sourceName} → {transfer.targetName}</td><td>{items.map((item) => <span className="block" key={item.productId}>{item.productName} × {Number(item.quantity).toLocaleString()} {item.unit} · {Number(item.allocatedFreight).toFixed(2)} freight</span>)}<small className="muted">Split by {transfer.freightBasis === "CATALOG_VALUE" ? "catalog value" : "quantity"}</small></td><td>{Number(transfer.freightCost).toFixed(2)}</td><td><span className={transfer.status === "RECEIVED" ? "tag tag-paid" : "tag"}>{transfer.status === "IN_TRANSIT" ? "In transit" : transfer.status}</span></td><td>{new Intl.DateTimeFormat(document.documentElement.lang || "en-IN", { dateStyle: "medium" }).format(new Date(transfer.createdAt))}</td><td>{canManage && transfer.status === "IN_TRANSIT" && <button className="button button-soft !px-3 !py-2 text-xs" disabled={busy} onClick={() => void submit(() => request(`/api/warehouse-transfers/${transfer.id}/receive`, { method: "POST" }))}>Receive goods</button>}</td></tr>;
      })}</tbody></table></div> : <p className="muted p-5 text-sm">{loading ? "Loading transfer history..." : "No transfer challans yet."}</p>}
    </section>
  </section>;
}