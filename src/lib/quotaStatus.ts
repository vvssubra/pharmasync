/**
 * The three statuses a drug_quota_patients enrolment can hold, matching the
 * drug_quota_patients_status_chk constraint added in
 * 20260827000000_quota_patient_status.sql.
 *
 * TIDAK AKTIF is the one that releases the national quota slot — drug_quota_used()
 * counts such an enrolment as 0 while still holding the patient's IC out of the
 * dispensing-request half. AKTIF and PENDING both consume the slot.
 */
export const QUOTA_STATUSES = ["AKTIF", "PENDING", "TIDAK AKTIF"] as const;

export type QuotaStatus = (typeof QUOTA_STATUSES)[number];

export function isQuotaStatus(value: string): value is QuotaStatus {
  return (QUOTA_STATUSES as readonly string[]).includes(value);
}

const STATUS_BADGE: Record<QuotaStatus, string> = {
  "AKTIF": "bg-green-100 text-green-700 border-green-300",
  "PENDING": "bg-amber-100 text-amber-700 border-amber-300",
  "TIDAK AKTIF": "bg-gray-100 text-gray-600 border-gray-300",
};

/**
 * Rows sourced from a dispensing request carry that REQUEST's status
 * ("approved", "fulfilled") rather than an enrolment status, so anything
 * unrecognised falls back to the neutral grey rather than reading as active.
 */
export function statusBadgeClass(status: string): string {
  const key = status.toUpperCase();
  return isQuotaStatus(key) ? STATUS_BADGE[key] : STATUS_BADGE["TIDAK AKTIF"];
}
