import type { Client, PostalAddress, SiteAddress } from "@/types/database";

const DEFAULT_STATE = "VIC";

export function createEmptySiteAddress(label = ""): SiteAddress {
  return {
    id: crypto.randomUUID(),
    label,
    street: "",
    suburb: "",
    state: DEFAULT_STATE,
    postcode: "",
  };
}

function normalizeSiteEntry(raw: unknown): SiteAddress | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const entry = raw as Record<string, unknown>;
  const street = typeof entry.street === "string" ? entry.street.trim() : "";
  const suburb = typeof entry.suburb === "string" ? entry.suburb.trim() : "";
  const state =
    typeof entry.state === "string" && entry.state.trim() ? entry.state.trim() : DEFAULT_STATE;
  const postcode = typeof entry.postcode === "string" ? entry.postcode.trim() : "";
  const label =
    typeof entry.label === "string" && entry.label.trim()
      ? entry.label.trim()
      : street
        ? "Site"
        : "Primary Site";
  const id =
    typeof entry.id === "string" && entry.id.trim()
      ? entry.id.trim()
      : crypto.randomUUID();

  if (!street && !suburb && !postcode) {
    return null;
  }

  return { id, label, street, suburb, state, postcode };
}

type LegacyClientSiteSource = {
  siteAddresses?: SiteAddress[];
  siteAddress?: PostalAddress;
  siteAddressStreet?: string;
  siteAddressSuburb?: string;
  siteAddressState?: string;
  siteAddressPostcode?: string;
};

/** Resolves site locations with backward-compatible fallbacks for legacy client docs. */
export function resolveClientSiteAddresses(client: LegacyClientSiteSource): SiteAddress[] {
  if (Array.isArray(client.siteAddresses) && client.siteAddresses.length > 0) {
    return client.siteAddresses
      .map((entry) => normalizeSiteEntry(entry))
      .filter((entry): entry is SiteAddress => entry !== null);
  }

  if (client.siteAddress?.line1?.trim()) {
    return [
      {
        id: "legacy-primary",
        label: "Primary Site",
        street: client.siteAddress.line1.trim(),
        suburb: client.siteAddress.suburb?.trim() ?? "",
        state: client.siteAddress.state?.trim() || DEFAULT_STATE,
        postcode: client.siteAddress.postcode?.trim() ?? "",
      },
    ];
  }

  if (typeof client.siteAddressStreet === "string" && client.siteAddressStreet.trim()) {
    return [
      {
        id: "legacy-primary",
        label: "Primary Site",
        street: client.siteAddressStreet.trim(),
        suburb: typeof client.siteAddressSuburb === "string" ? client.siteAddressSuburb.trim() : "",
        state:
          typeof client.siteAddressState === "string" && client.siteAddressState.trim()
            ? client.siteAddressState.trim()
            : DEFAULT_STATE,
        postcode:
          typeof client.siteAddressPostcode === "string" ? client.siteAddressPostcode.trim() : "",
      },
    ];
  }

  return [];
}

export function siteAddressToPostal(site: SiteAddress): PostalAddress {
  return {
    line1: site.street.trim(),
    suburb: site.suburb.trim(),
    state: site.state.trim() || DEFAULT_STATE,
    postcode: site.postcode.trim(),
    country: "Australia",
  };
}

export function postalAddressToSite(
  address: PostalAddress,
  id = "legacy-primary",
  label = "Primary Site",
): SiteAddress {
  return {
    id,
    label,
    street: address.line1.trim(),
    suburb: address.suburb.trim(),
    state: address.state.trim() || DEFAULT_STATE,
    postcode: address.postcode.trim(),
  };
}

export function formatSiteAddressOption(site: SiteAddress): string {
  const location = [site.street, site.suburb].filter(Boolean).join(", ");
  return location ? `${site.label} (${location})` : site.label;
}

export function normalizeClientRecord(client: Client): Client {
  const siteAddresses = resolveClientSiteAddresses(client);
  const primarySite = siteAddresses[0];

  return {
    ...client,
    siteAddresses,
    siteAddress: primarySite ? siteAddressToPostal(primarySite) : client.siteAddress,
  };
}

export type ClientFormState = {
  displayName: string;
  legalName: string;
  email: string;
  phone: string;
  notes: string;
  billingLine1: string;
  billingSuburb: string;
  billingState: string;
  billingPostcode: string;
  siteAddresses: SiteAddress[];
  isSchoolClient: boolean;
  defaultPurchaseOrderNumber: string;
};

export function clientToFormState(client: Client): ClientFormState {
  const sites = resolveClientSiteAddresses(client);

  return {
    displayName: client.displayName ?? "",
    legalName: client.legalName ?? "",
    email: client.email ?? "",
    phone: client.phone ?? "",
    notes: client.notes ?? "",
    billingLine1: client.billingAddress?.line1 ?? "",
    billingSuburb: client.billingAddress?.suburb ?? "",
    billingState: client.billingAddress?.state ?? DEFAULT_STATE,
    billingPostcode: client.billingAddress?.postcode ?? "",
    siteAddresses: sites.length > 0 ? sites : [],
    isSchoolClient: client.isSchoolClient,
    defaultPurchaseOrderNumber: client.defaultPurchaseOrderNumber ?? "",
  };
}

export function createEmptyClientFormState(): ClientFormState {
  return {
    displayName: "",
    legalName: "",
    email: "",
    phone: "",
    notes: "",
    billingLine1: "",
    billingSuburb: "",
    billingState: DEFAULT_STATE,
    billingPostcode: "",
    siteAddresses: [],
    isSchoolClient: false,
    defaultPurchaseOrderNumber: "",
  };
}

function buildBillingAddress(form: ClientFormState): PostalAddress | undefined {
  if (!form.billingLine1.trim()) {
    return undefined;
  }
  return {
    line1: form.billingLine1.trim(),
    suburb: form.billingSuburb.trim(),
    state: form.billingState.trim() || DEFAULT_STATE,
    postcode: form.billingPostcode.trim(),
    country: "Australia",
  };
}

function sanitizeSiteAddresses(sites: SiteAddress[]): SiteAddress[] {
  return sites
    .map((site) => normalizeSiteEntry(site))
    .filter((site): site is SiteAddress => site !== null);
}

export function clientFormToCreateInput(form: ClientFormState) {
  const siteAddresses = sanitizeSiteAddresses(form.siteAddresses);
  const primarySite = siteAddresses[0];

  return {
    displayName: form.displayName.trim(),
    legalName: form.legalName.trim() || undefined,
    email: form.email.trim() || undefined,
    phone: form.phone.trim() || undefined,
    notes: form.notes.trim() || undefined,
    isSchoolClient: form.isSchoolClient,
    defaultPurchaseOrderNumber: form.isSchoolClient
      ? form.defaultPurchaseOrderNumber.trim() || undefined
      : undefined,
    billingAddress: buildBillingAddress(form),
    siteAddresses,
    siteAddress: primarySite ? siteAddressToPostal(primarySite) : undefined,
  };
}

export function clientFormToUpdateInput(form: ClientFormState) {
  const siteAddresses = sanitizeSiteAddresses(form.siteAddresses);
  const primarySite = siteAddresses[0];

  return {
    displayName: form.displayName.trim(),
    legalName: form.legalName.trim() || undefined,
    email: form.email.trim() || undefined,
    phone: form.phone.trim() || undefined,
    notes: form.notes.trim() || undefined,
    billingAddress: buildBillingAddress(form),
    siteAddresses,
    siteAddress: primarySite ? siteAddressToPostal(primarySite) : undefined,
  };
}

export const CLIENT_FIELD_LABEL =
  "text-[11px] font-bold text-[#676879] uppercase tracking-wider mb-1.5 block";

export const CLIENT_FIELD_INPUT =
  "bg-white border border-[#C3C6D4] text-[#323338] text-sm rounded-md px-3 py-2 w-full focus:border-[#0073EA] focus:ring-1 focus:ring-[#0073EA] focus:outline-none transition-all";

export const CLIENT_SECTION_TITLE =
  "text-[11px] font-bold text-[#676879] tracking-wider mb-2 block uppercase";

export const AU_STATES = ["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"] as const;
