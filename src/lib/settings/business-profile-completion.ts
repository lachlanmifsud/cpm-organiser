import type { BusinessProfile } from "@/types/database";

/** Human-readable checklist for document prompts / template saves. */
export function getBusinessProfileCompletionIssues(profile: BusinessProfile | null | undefined): string[] {
  if (!profile) {
    return ["Business profile has not been created yet."];
  }

  const issues: string[] = [];

  if (!profile.businessName?.trim()) {
    issues.push("Business name is required.");
  }
  if (!profile.abnOrAcn?.trim()) {
    issues.push("ABN or ACN is required.");
  }
  if (!profile.bankName?.trim()) {
    issues.push("Bank name is required.");
  }
  if (!profile.bsb?.trim()) {
    issues.push("BSB is required.");
  }
  if (!profile.accountNumber?.trim()) {
    issues.push("Account number is required.");
  }

  const addr = profile.address;
  if (!addr) {
    issues.push("Business postal address is required.");
  } else {
    if (!addr.line1?.trim()) {
      issues.push("Street address (line 1) is required.");
    }
    if (!addr.suburb?.trim()) {
      issues.push("Suburb is required.");
    }
    if (!addr.state?.trim()) {
      issues.push("State is required.");
    }
    if (!addr.postcode?.trim()) {
      issues.push("Postcode is required.");
    }
    if (!addr.country?.trim()) {
      issues.push("Country is required.");
    }
  }

  return issues;
}

export function isBusinessProfileComplete(profile: BusinessProfile | null | undefined): boolean {
  return getBusinessProfileCompletionIssues(profile).length === 0;
}

/**
 * Builds a Firestore-safe `businessProfile` map: no `undefined` anywhere (including nested).
 * Optional logo fields are omitted when empty; `address` is omitted when absent.
 */
export function sanitizeBusinessProfileForFirestore(profile: BusinessProfile): Record<string, unknown> {
  const out: Record<string, unknown> = {
    businessName: profile.businessName ?? "",
    abnOrAcn: profile.abnOrAcn ?? "",
    bankName: profile.bankName ?? "",
    bsb: profile.bsb ?? "",
    accountNumber: profile.accountNumber ?? "",
    paymentTerms: profile.paymentTerms ?? "Net 7 days",
  };

  if (profile.logoUrl?.trim()) {
    out.logoUrl = profile.logoUrl.trim();
  }
  if (profile.logoStoragePath?.trim()) {
    out.logoStoragePath = profile.logoStoragePath.trim();
  }

  if (profile.address) {
    const a = profile.address;
    const address: Record<string, unknown> = {
      line1: a.line1 ?? "",
      suburb: a.suburb ?? "",
      state: a.state ?? "",
      postcode: a.postcode ?? "",
      country: a.country ?? "Australia",
    };
    if (a.line2 != null && String(a.line2).trim() !== "") {
      address.line2 = String(a.line2).trim();
    }
    out.address = address;
  }

  return out;
}
