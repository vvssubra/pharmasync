// Malaysian IC (No. Kad Pengenalan) helpers, shared by the patient registry
// and quota-patient table. Storage is always digits-only; display is always
// dash-formatted (YYMMDD-PB-###G).

export function formatIC(ic: string): string {
  const d = ic.replace(/\D/g, "");
  if (d.length === 12) return `${d.slice(0, 6)}-${d.slice(6, 8)}-${d.slice(8)}`;
  return ic;
}

export function formatICInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 12);
  if (digits.length <= 6) return digits;
  if (digits.length <= 8) return `${digits.slice(0, 6)}-${digits.slice(6)}`;
  return `${digits.slice(0, 6)}-${digits.slice(6, 8)}-${digits.slice(8)}`;
}

export function isValidIC(ic: string): boolean {
  return ic.replace(/\D/g, "").length === 12;
}
