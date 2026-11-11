export type EWayAction = "CREATE" | "UPDATE" | "CANCEL";

export function canPrepareLocalEWayPayload(status: string | null | undefined): boolean {
  return !status || ["READY", "FAILED", "CANCELLED"].includes(status);
}

export function canStartEWayOperation(action: EWayAction, status: string | null | undefined, ewayBillNumber: string | null | undefined): boolean {
  if (action === "CREATE") return canPrepareLocalEWayPayload(status);
  return status === "SUBMITTED" && Boolean(ewayBillNumber);
}

export function ewayProviderSuccessStatus(action: EWayAction, ewayBillNumber: string): string {
  if (action === "CANCEL") return "CANCELLED";
  if (action === "CREATE" && !ewayBillNumber) return "PROVIDER_ACCEPTED";
  return "SUBMITTED";
}