export const EARLY_ACCESS_ROLES = [
  'Engineering leader',
  'Software engineer',
  'Product manager',
  'Founder / executive',
  'Operations / program manager',
  'Other'
] as const;

export type EarlyAccessRole = (typeof EARLY_ACCESS_ROLES)[number];

export const earlyAccessRoles = [...EARLY_ACCESS_ROLES];
