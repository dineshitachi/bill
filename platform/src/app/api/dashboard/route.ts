import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth";

export async function GET() {
  const auth = await requireSession(["ADMIN", "SALES"]);
  if ("response" in auth) return auth.response;
  const { db, session } = auth;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [products, invoiceCount, todayStats, customers] = await Promise.all([
    db.product.findMany({ orderBy: { name: "asc" } }),
    db.invoice.count({ where: { status: "INVOICE" } }),
    db.invoice.aggregate({
      where: {
        status: "INVOICE",
        issuedAt: { gte: today },
      },
      _sum: { grandTotal: true },
      _count: { _all: true },
    }),
    db.customer.count(),
  ]);
  const inventory = products.map((product) => {
    const stock = Number(product.stock);
    return {
      ...product,
      price: Number(product.price),
      stock,
      lowStockAt: Number(product.lowStockAt),
      gstRate: Number(product.gstRate),
      ...(session.role === "ADMIN" ? { inventoryValue: Number(product.price) * stock } : {}),
      lowStock: stock <= Number(product.lowStockAt),
    };
  });
  return NextResponse.json({
    inventory,
    lowStock: inventory.filter((item) => item.lowStock),
    customers,
    summary: {
      invoiceCount,
      salesToday: session.role === "ADMIN" ? Number(todayStats._sum.grandTotal || 0) : null,
      invoiceCountToday: todayStats._count._all,
      inventoryValue: session.role === "ADMIN"
        ? inventory.reduce((sum, item) => sum + (item.inventoryValue || 0), 0)
        : null,
    },
    canViewFinancials: session.role === "ADMIN",
  });
}
