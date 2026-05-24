"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { generateTemplateFromPrompt } from "@/lib/ai/template-architect-client";
import {
  DEFAULT_ARCHITECT_TEMPLATE,
  DEFAULT_INVOICE_PROMPT,
  DEFAULT_QUOTE_PROMPT,
} from "@/config/default-document-ai-prompts";
import Link from "next/link";
import { getUserSettings, saveDocumentTemplate, saveUserSettings } from "@/lib/firebase/repository";
import {
  getBusinessProfileCompletionIssues,
  isBusinessProfileComplete,
} from "@/lib/settings/business-profile-completion";

const cardShell =
  "rounded-xl border border-[#E6E9EF] bg-white p-6 shadow-sm md:p-8";

const sectionMarkerClass =
  "mb-2 text-[11px] font-bold uppercase tracking-wider text-[#0073EA]";

const textareaClass =
  "min-h-40 w-full rounded-md border border-[#C3C6D4] bg-white p-3 text-sm text-[#323338] transition-all focus:border-[#0073EA] focus:ring-1 focus:ring-[#0073EA] focus:outline-none";

const blueprintCardClass =
  "rounded-lg border border-[#E6E9EF] bg-white p-4 shadow-sm transition-all hover:border-[#C3C6D4] hover:shadow-md";

export function InvoiceQuoteTemplateSettings() {
  const queryClient = useQueryClient();
  const [templatePrompt, setTemplatePrompt] = useState("");
  const [invoicePrompt, setInvoicePrompt] = useState("");
  const [quotePrompt, setQuotePrompt] = useState("");

  const { data: settings, isLoading } = useQuery({
    queryKey: ["user-settings"],
    queryFn: getUserSettings,
  });

  const profileIssues =
    settings != null
      ? getBusinessProfileCompletionIssues(settings.businessProfile)
      : !isLoading
        ? ["Open Business information in Settings and save your company details first."]
        : [];
  const profileComplete = settings != null && isBusinessProfileComplete(settings.businessProfile);

  useEffect(() => {
    if (!settings) {
      return;
    }
    setInvoicePrompt(settings.invoiceSystemPrompt ?? "");
    setQuotePrompt(settings.quoteSystemPrompt ?? "");
  }, [settings?.invoiceSystemPrompt, settings?.quoteSystemPrompt, settings]);

  const savePromptsMutation = useMutation({
    mutationFn: async () => {
      if (!settings?.businessProfile) {
        throw new Error("Settings are still loading. Try again in a moment.");
      }
      if (!isBusinessProfileComplete(settings.businessProfile)) {
        throw new Error(
          "Complete your business profile before saving prompts. Use the link above to open Business information.",
        );
      }
      return saveUserSettings(
        {
          businessProfile: settings.businessProfile,
          templates: settings.templates,
          invoiceSystemPrompt: invoicePrompt,
          quoteSystemPrompt: quotePrompt,
        },
        { enforceCompleteBusinessProfile: true },
      );
    },
    onSuccess: async () => {
      toast.success("Document prompts saved");
      await queryClient.invalidateQueries({ queryKey: ["user-settings"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const templateMutation = useMutation({
    mutationFn: async () => {
      if (!settings || !isBusinessProfileComplete(settings.businessProfile)) {
        throw new Error(
          "Complete your business profile before generating a template. Use the link above to open Business information.",
        );
      }
      if (!templatePrompt.trim()) {
        throw new Error("Describe the layout you want first.");
      }
      const generated = await generateTemplateFromPrompt(templatePrompt);
      return saveDocumentTemplate({
        name: generated.suggestedName,
        prompt: templatePrompt,
        style: generated.style,
      });
    },
    onSuccess: async () => {
      toast.success("Template saved");
      setTemplatePrompt("");
      await queryClient.invalidateQueries({ queryKey: ["user-settings"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  if (isLoading && !settings) {
    return (
      <div className="space-y-6">
        <div className="h-48 animate-pulse rounded-lg bg-[#F5F6F8]" />
        <div className="h-64 animate-pulse rounded-lg bg-[#F5F6F8]" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {!isLoading && profileIssues.length > 0 ? (
        <div className="rounded-lg border border-[#FDAB3D]/40 bg-[#FFF7E6] px-4 py-4 text-sm text-[#323338] shadow-sm">
          <p className="font-semibold text-[#323338]">Finish your business profile first</p>
          <p className="mt-1 leading-relaxed text-[#676879]">
            Document prompts and AI layout templates are tied to your legal and banking details. Complete the
            checklist below, then return here.
          </p>
          <ul className="mt-3 list-inside list-disc space-y-1 text-[#676879]">
            {profileIssues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
          <Link
            href="/settings?section=business"
            className="mt-4 inline-flex rounded-md border border-[#FDAB3D]/50 bg-white px-3 py-2 text-sm font-semibold text-[#323338] transition-colors hover:bg-[#FFF7E6]"
          >
            Go to Business information
          </Link>
        </div>
      ) : null}

      {/* 1. Visual layout blueprint → JSON templates (Firestore: templates[]) */}
      <section className={cardShell}>
        <p className={sectionMarkerClass}>1. Global visual design blueprint</p>
        <h2 className="mt-2 text-xl font-bold tracking-tight text-[#323338]">Visual layout architect</h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[#676879]">
          Describe how your quotes and invoices should look visually (e.g., layout styles, column placement,
          color themes). The AI converts this into a layout blueprint used globally across all documents.
        </p>

        <div className="mt-3 flex flex-wrap justify-end">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="border border-[#E6E9EF] transition-all duration-150 ease-in-out active:scale-[0.97] hover:border-[#0073EA]/400/40 hover:bg-[#F5F6F8]"
            onClick={() => setTemplatePrompt(DEFAULT_ARCHITECT_TEMPLATE)}
          >
            Load example
          </Button>
        </div>

        <div className="mt-4 space-y-4">
          <Textarea
            value={templatePrompt}
            onChange={(event) => {
              setTemplatePrompt(event.target.value);
            }}
            className={textareaClass}
            placeholder="e.g. Minimalist layout with a large total at the bottom and separate labor/material sections."
          />
          <Button
            type="button"
            onClick={() => templateMutation.mutate()}
            disabled={templateMutation.isPending || !profileComplete}
            className="transition-transform duration-300 ease-out active:scale-[0.97]"
          >
            Generate template JSON
          </Button>
        </div>

        <div className="mt-8 space-y-3 border-t border-[#E6E9EF] pt-6">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#676879]">
            Saved layout blueprints
          </p>
          {(settings?.templates ?? []).length === 0 ? (
            <p className="text-sm text-[#676879]">No templates saved yet.</p>
          ) : (
            <ul className="space-y-3">
              {(settings?.templates ?? []).map((template) => (
                <li key={template.id} className={blueprintCardClass}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-[#323338]">{template.name}</p>
                      <p className="mt-1 text-sm text-[#676879]">{template.prompt}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-[#F5F6F8] px-2 py-1 text-xs text-[#676879]">
                      {template.style.tableStyle}
                    </span>
                  </div>
                  <p className="mt-3 text-[10px] uppercase tracking-[0.2em] text-[#676879]">
                    {template.style.sectionOrder.join(" / ")}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* 2. Content / logic prompts (Firestore: invoiceSystemPrompt, quoteSystemPrompt) */}
      <section className={cardShell}>
        <p className={sectionMarkerClass}>2. Document intelligence rules</p>
        <h2 className="mt-2 text-xl font-bold tracking-tight text-[#323338]">AI text &amp; logic prompts</h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[#676879]">
          Establish custom guidelines for how the AI writes, phrases, and calculates values when assembling data
          files.
        </p>

        <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <label className="text-xs font-bold uppercase tracking-wide text-[#323338]">
                Invoice generation prompt
              </label>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="shrink-0 border border-[#E6E9EF] transition-all duration-150 ease-in-out active:scale-[0.97] hover:border-[#0073EA]/400/40 hover:bg-[#F5F6F8]"
                onClick={() => setInvoicePrompt(DEFAULT_INVOICE_PROMPT)}
              >
                Load example
              </Button>
            </div>
            <p className="text-xs leading-relaxed text-[#676879]">
              Guidance for interpreting completed labor and final materials pricing.
            </p>
            <Textarea
              value={invoicePrompt}
              onChange={(e) => setInvoicePrompt(e.target.value)}
              className={textareaClass}
              placeholder="Voice, tone, mandatory sections, and billing language for standard invoices…"
            />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <label className="text-xs font-bold uppercase tracking-wide text-[#323338]">
                Quote generation prompt
              </label>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="shrink-0 border border-[#E6E9EF] transition-all duration-150 ease-in-out active:scale-[0.97] hover:border-[#0073EA]/400/40 hover:bg-[#F5F6F8]"
                onClick={() => setQuotePrompt(DEFAULT_QUOTE_PROMPT)}
              >
                Load example
              </Button>
            </div>
            <p className="text-xs leading-relaxed text-[#676879]">
              Guidance for writing job descriptions and material estimates for prospective clients.
            </p>
            <Textarea
              value={quotePrompt}
              onChange={(e) => setQuotePrompt(e.target.value)}
              className={textareaClass}
              placeholder="How estimates should read, inclusions/exclusions, and tone for quotes…"
            />
          </div>
        </div>

        <div className="mt-8 flex justify-center border-t border-[#E6E9EF] pt-6">
          <Button
            type="button"
            onClick={() => savePromptsMutation.mutate()}
            disabled={savePromptsMutation.isPending || !settings || !profileComplete}
            className="min-w-[12rem] transition-transform duration-300 ease-out active:scale-[0.97]"
          >
            Save Prompts
          </Button>
        </div>
      </section>
    </div>
  );
}
