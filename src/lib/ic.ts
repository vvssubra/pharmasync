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

/** MyKad encodes sex in the last digit: odd = male, even = female. */
export function getGenderFromIC(ic: string): "Male" | "Female" | null {
  const d = ic.replace(/\D/g, "");
  if (d.length !== 12) return null;
  return Number(d[11]) % 2 === 1 ? "Male" : "Female";
}

/** Age in whole years derived from the YYMMDD birth date prefix. */
export function getAgeFromIC(ic: string, now: Date = new Date()): number | null {
  const d = ic.replace(/\D/g, "");
  if (d.length !== 12) return null;
  const yy = Number(d.slice(0, 2));
  const month = Number(d.slice(2, 4));
  const day = Number(d.slice(4, 6));
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const currentYY = now.getFullYear() % 100;
  const century = yy > currentYY ? 1900 : 2000;
  const birthDate = new Date(century + yy, month - 1, day);
  let age = now.getFullYear() - birthDate.getFullYear();
  const hasHadBirthdayThisYear =
    now.getMonth() > birthDate.getMonth() ||
    (now.getMonth() === birthDate.getMonth() && now.getDate() >= birthDate.getDate());
  if (!hasHadBirthdayThisYear) age -= 1;
  return age;
}
