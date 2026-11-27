"use client";

import { Printer } from "lucide-react";

export function PrintReceiptButton() {
  return <button type="button" className="waybook-action waybook-action--secondary" onClick={() => window.print()}>
    <Printer size={16} aria-hidden="true" /> Print receipt
  </button>;
}
