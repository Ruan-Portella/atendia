"use client";

import { Printer } from "lucide-react";

/** Abre a impressão do navegador (o cliente escolhe "Salvar como PDF"). */
export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="btn-ghost print:hidden">
      <Printer size={15} />Salvar em PDF
    </button>
  );
}
