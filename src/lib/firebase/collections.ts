export const COLLECTIONS = {
  clients: "clients",
  jobs: "jobs",
  quotes: "quotes",
  invoices: "invoices",
  lineItems: "lineItems",
  receipts: "receipts",
  userSettings: "userSettings",
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];
