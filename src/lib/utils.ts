import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// First letters of the first two words — "CHE KU AIMARA" -> "CK". Purely a
// visual avatar chip, no identity logic rides on it.
export function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map(w => w[0]).join("").toUpperCase() || "?";
}
