export const currencies = ["MDL", "EUR", "USD"] as const;
export const availabilityOptions = ["In stock", "Out of stock", "Pre-order", "Limited stock"] as const;
export const segmentOptions = ["Office", "HoReCa", "Retail", "Other"] as const;
export const updateScopes = ["Price", "Availability", "Description", "Photos", "Full product card"] as const;

export const isPositivePrice = (value: string): boolean => {
  const normalized = value.trim().replace(",", ".");
  const number = Number(normalized);
  return Number.isFinite(number) && number > 0;
};

export const normalizePrice = (value: string): string => value.trim().replace(",", ".");

export const validateRequired = (value?: string): boolean => Boolean(value?.trim());

export const isCurrency = (value: string): boolean => currencies.includes(value as any);

export const isAvailability = (value: string): boolean => availabilityOptions.includes(value as any);

export const isSegment = (value: string): boolean => segmentOptions.includes(value as any);
