// The pet's size preference: how many CSS px one sprite pixel takes.
export const PET_SIZE_OPTIONS = ["small", "medium", "large"] as const;
export type PetSize = (typeof PET_SIZE_OPTIONS)[number];
export const DEFAULT_PET_SIZE: PetSize = "medium";

export const PET_SIZE_SCALE: Readonly<Record<PetSize, number>> = {
  small: 2,
  medium: 3,
  large: 4,
};

export function isPetSize(v: unknown): v is PetSize {
  return PET_SIZE_OPTIONS.includes(v as PetSize);
}
