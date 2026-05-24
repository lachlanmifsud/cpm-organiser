"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { compileDocumentPdfFromPayload } from "@/components/generated-document-pdf";
import { TradeLoader } from "@/components/trade-loader";
import { fetchRefineDocumentPayload } from "@/lib/ai/document-refinement-client";
import {
  applyRefinementDelta,
  refinementDeltaHasChanges,
  type DocumentRefinementPayload,
} from "@/lib/document-refinement-payload";
import {
  formatVersionTimestamp,
  type DocumentVersion,
} from "@/lib/document-versions";
import { cn } from "@/lib/utils";

type ChatRole = "user" | "assistant" | "system";
type RightPaneTab = "ai" | "history";

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
};

const QUICK_PROMPTS = [
  "Apply 10% discount",
  "Remove labor breakdown",
  "Make tone friendlier",
] as const;

export type DocumentRefinementFinalizeMeta = {
  commitMessage: string;
};

type DocumentRefinementStudioProps = {
  isOpen: boolean;
  initialPayload: DocumentRefinementPayload;
  versions?: DocumentVersion[];
  mode?: "create" | "edit";
  onCancel: () => void;
  onFinalize: (
    payload: DocumentRefinementPayload,
    pdfFile: File,
    meta: DocumentRefinementFinalizeMeta,
  ) => Promise<void>;
};

function makeChatId() {
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function studioTitle(payload: DocumentRefinementPayload, mode: "create" | "edit") {
  const label = payload.documentType === "invoice" ? "Invoice" : "Quote";
  const verb = mode === "edit" ? "Editing" : "Drafting";
  return `${verb} ${label} #${payload.documentNumber}`;
}

function refinementFailureMessage(error: unknown): string {
  if (error instanceof TypeError) {
    return "Failed to apply changes. The AI timed out or the request was blocked.";
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "Failed to apply changes. The AI timed out or the request was blocked.";
}

export function DocumentRefinementStudio({
  isOpen,
  initialPayload,
  versions: initialVersions = [],
  mode = "create",
  onCancel,
  onFinalize,
}: DocumentRefinementStudioProps) {
  const [currentDocumentPayload, setCurrentDocumentPayload] =
    useState<DocumentRefinementPayload>(initialPayload);
  const [versionHistory, setVersionHistory] = useState<DocumentVersion[]>(initialVersions);
  const [rightPaneTab, setRightPaneTab] = useState<RightPaneTab>("ai");
  const [previewVersionId, setPreviewVersionId] = useState<string | null>(null);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [isRefining, setIsRefining] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([
    {
      id: makeChatId(),
      role: "system",
      content:
        initialPayload.documentType === "invoice"
          ? "Invoice layout generated successfully."
          : "Quote layout generated successfully.",
    },
  ]);

  const lastAiPromptRef = useRef<string>("");
  const blobUrlRef = useRef<string | null>(null);

  const sortedVersions = useMemo(
    () => [...versionHistory].sort((a, b) => b.timestamp - a.timestamp),
    [versionHistory],
  );

  const previewVersion = useMemo(
    () => sortedVersions.find((version) => version.versionId === previewVersionId) ?? null,
    [previewVersionId, sortedVersions],
  );

  const displayPayload = previewVersion?.payload ?? currentDocumentPayload;

  const assignBlobUrl = useCallback((blob: Blob) => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
    }
    const url = URL.createObjectURL(blob);
    blobUrlRef.current = url;
    setPdfBlobUrl(url);
  }, []);

  const rebuildPdf = useCallback(
    async (payload: DocumentRefinementPayload) => {
      const blob = await compileDocumentPdfFromPayload(payload);
      assignBlobUrl(blob);
    },
    [assignBlobUrl],
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setCurrentDocumentPayload(initialPayload);
    setVersionHistory(initialVersions);
    setPreviewVersionId(null);
    setRightPaneTab("ai");
    setChatHistory([
      {
        id: makeChatId(),
        role: "system",
        content:
          mode === "edit"
            ? "Document loaded for refinement. Changes commit only when you Save & Finalize."
            : initialPayload.documentType === "invoice"
              ? "Invoice layout generated successfully."
              : "Quote layout generated successfully.",
      },
    ]);
    setChatInput("");
    lastAiPromptRef.current = "";
    void rebuildPdf(initialPayload);
  }, [isOpen, initialPayload, initialVersions, mode, rebuildPdf]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    void rebuildPdf(displayPayload);
  }, [displayPayload, isOpen, rebuildPdf]);

  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, []);

  const clearPreview = () => {
    setPreviewVersionId(null);
  };

  const runRefinement = async (message: string) => {
    const trimmed = message.trim();
    if (!trimmed || isRefining) {
      return;
    }

  if (previewVersionId) {
      clearPreview();
    }

    setIsRefining(true);
    lastAiPromptRef.current = trimmed;
    setChatHistory((prev) => [
      ...prev,
      { id: makeChatId(), role: "user", content: trimmed },
    ]);
    setChatInput("");

    try {
      const delta = await fetchRefineDocumentPayload({
        payload: currentDocumentPayload,
        userMessage: trimmed,
      });

      if (!refinementDeltaHasChanges(delta)) {
        throw new Error("The AI did not return any changes. Try rephrasing your request.");
      }

      const nextPayload = applyRefinementDelta(currentDocumentPayload, delta);
      setCurrentDocumentPayload(nextPayload);

      toast.success("Changes applied.");
      setChatHistory((prev) => [
        ...prev,
        {
          id: makeChatId(),
          role: "assistant",
          content: "Changes applied. Review the updated preview on the left.",
        },
      ]);
    } catch (error) {
      console.error("Refinement error:", error);
      toast.error(refinementFailureMessage(error));
      setChatHistory((prev) => [
        ...prev,
        {
          id: makeChatId(),
          role: "assistant",
          content: "I could not apply that change. Try rephrasing your request.",
        },
      ]);
    } finally {
      setIsRefining(false);
    }
  };

  const handlePreviewVersion = (version: DocumentVersion) => {
    setPreviewVersionId(version.versionId);
  };

  const handleRestoreVersion = (version: DocumentVersion) => {
    setCurrentDocumentPayload(version.payload);
    setPreviewVersionId(null);
    toast.success("Version restored to the editor.");
  };

  const handleFinalize = async () => {
    if (isSaving || !pdfBlobUrl || previewVersionId) {
      if (previewVersionId) {
        toast.error("Restore this version or exit preview before saving.");
      }
      return;
    }

    setIsSaving(true);
    try {
      const blob = await fetch(pdfBlobUrl).then((r) => r.blob());
      const file = new File(
        [blob],
        `${currentDocumentPayload.documentType}-${currentDocumentPayload.documentNumber.toLowerCase().replace(/[^a-z0-9-]+/g, "-")}.pdf`,
        { type: "application/pdf" },
      );
      const commitMessage =
        lastAiPromptRef.current.trim() ||
        (mode === "edit" ? "Document updated" : "Initial Generation");

      await onFinalize(currentDocumentPayload, file, { commitMessage });

      const nextVersion: DocumentVersion = {
        versionId: crypto.randomUUID(),
        timestamp: Date.now(),
        commitMessage,
        payload: currentDocumentPayload,
      };
      setVersionHistory((prev) => [...prev, nextVersion]);
      lastAiPromptRef.current = "";
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save document.");
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-white">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-[#E6E9EF] bg-white px-6">
        <h1 className="text-lg font-bold text-[#323338]">{studioTitle(currentDocumentPayload, mode)}</h1>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSaving}
            className="rounded-md px-4 py-2 text-sm font-medium text-[#676879] transition-colors hover:bg-[#F5F6F8] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleFinalize()}
            disabled={isSaving || isRefining || !pdfBlobUrl || Boolean(previewVersionId)}
            className="rounded-md bg-[#0073EA] px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#0060B9] disabled:opacity-50"
          >
            {isSaving ? "Saving…" : "Save & Finalize"}
          </button>
        </div>
      </header>

      <div className="flex h-[calc(100vh-64px)] w-full">
        <div className="relative flex w-[70%] flex-col overflow-hidden bg-[#F0F4F8]">
          {previewVersion ? (
            <div className="border-b border-[#0073EA]/20 bg-[#EAF4FF] px-6 py-3 text-sm text-[#323338]">
              Previewing historical version. Click <span className="font-semibold">Restore</span> to revert to this state.
            </div>
          ) : null}

          <div className="relative flex flex-1 items-center justify-center overflow-y-auto p-8">
            <div className="relative h-full w-full max-w-4xl overflow-hidden rounded-sm bg-white shadow-[0_8px_30px_rgb(0,0,0,0.12)]">
              {pdfBlobUrl ? (
                <iframe src={pdfBlobUrl} title="Document preview" className="h-full min-h-[70vh] w-full" />
              ) : (
                <div className="flex min-h-[70vh] items-center justify-center">
                  <TradeLoader />
                </div>
              )}
              {isRefining ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/60 backdrop-blur-sm">
                  <TradeLoader />
                  <p className="mt-4 text-sm font-semibold text-[#323338]">Rebuilding your document…</p>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex h-full w-[30%] flex-col border-l border-[#E6E9EF] bg-white">
          <div className="flex border-b border-[#E6E9EF]">
            <button
              type="button"
              onClick={() => setRightPaneTab("ai")}
              className={cn(
                "flex-1 px-4 py-3 text-sm transition-colors",
                rightPaneTab === "ai"
                  ? "border-b-2 border-[#0073EA] font-semibold text-[#0073EA]"
                  : "text-[#676879] hover:bg-[#F5F6F8]",
              )}
            >
              ✨ AI Assistant
            </button>
            <button
              type="button"
              onClick={() => setRightPaneTab("history")}
              className={cn(
                "flex-1 px-4 py-3 text-sm transition-colors",
                rightPaneTab === "history"
                  ? "border-b-2 border-[#0073EA] font-semibold text-[#0073EA]"
                  : "text-[#676879] hover:bg-[#F5F6F8]",
              )}
            >
              🕒 Version History
            </button>
          </div>

          {rightPaneTab === "ai" ? (
            <>
              <div className="flex-1 space-y-4 overflow-y-auto p-6">
                {chatHistory.map((message) =>
                  message.role === "system" ? (
                    <p key={message.id} className="text-xs text-[#676879]">
                      {message.content}
                    </p>
                  ) : message.role === "user" ? (
                    <div key={message.id} className="flex justify-end">
                      <p className="max-w-[90%] rounded-xl rounded-tr-sm bg-[#F5F6F8] px-4 py-2 text-sm text-[#323338]">
                        {message.content}
                      </p>
                    </div>
                  ) : (
                    <div key={message.id} className="flex justify-start">
                      <p className="max-w-[90%] rounded-xl rounded-tl-sm border border-[#E6E9EF] bg-white px-4 py-2 text-sm text-[#323338]">
                        {message.content}
                      </p>
                    </div>
                  ),
                )}
              </div>

              <div className="shrink-0 border-t border-[#E6E9EF] bg-[#FAFBFC]">
                <div className="flex gap-2 overflow-x-auto p-4">
                  {QUICK_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      disabled={isRefining || isSaving}
                      onClick={() => void runRefinement(prompt)}
                      className="cursor-pointer whitespace-nowrap rounded-full border border-[#C3C6D4] px-3 py-1 text-xs font-semibold text-[#676879] transition-colors hover:border-[#0073EA] hover:text-[#0073EA] disabled:opacity-50"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>

                <div className="relative p-4 pt-0">
                  <textarea
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void runRefinement(chatInput);
                      }
                    }}
                    rows={3}
                    placeholder="Ask AI to adjust totals, tone, or layout copy…"
                    disabled={isRefining || isSaving}
                    className={cn(
                      "w-full resize-none rounded-lg border border-transparent bg-[#F5F6F8] p-3 pr-12 text-sm text-[#323338] transition-all placeholder:text-[#676879] focus:border-[#0073EA] focus:bg-white focus:ring-1 focus:ring-[#0073EA] focus:outline-none disabled:opacity-50",
                    )}
                  />
                  <button
                    type="button"
                    disabled={isRefining || isSaving || !chatInput.trim()}
                    onClick={() => void runRefinement(chatInput)}
                    className="absolute right-6 bottom-6 rounded-md bg-[#0073EA] p-1.5 text-white transition-colors hover:bg-[#0060B9] disabled:opacity-50"
                    aria-label="Send refinement"
                  >
                    <Send className="size-4" aria-hidden />
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 overflow-y-auto p-6">
              {sortedVersions.length === 0 ? (
                <p className="text-sm text-[#676879]">No saved versions yet.</p>
              ) : (
                <div className="space-y-0">
                  {sortedVersions.map((version, index) => {
                    const versionNumber = sortedVersions.length - index;
                    const isActivePreview = previewVersionId === version.versionId;
                    return (
                      <div key={version.versionId} className="relative pl-6">
                        <div className="absolute top-2 left-0 h-full border-l-2 border-[#E6E9EF]" />
                        <div
                          className={cn(
                            "absolute top-2 left-[-5px] size-3 rounded-full border-2 border-white ring-1 ring-[#C3C6D4]",
                            isActivePreview ? "bg-[#0073EA]" : "bg-[#0073EA]",
                          )}
                        />
                        <button
                          type="button"
                          onClick={() => handlePreviewVersion(version)}
                          className={cn(
                            "group relative mb-6 ml-2 w-[calc(100%-0.5rem)] rounded-xl border p-4 text-left transition-all hover:border-[#0073EA] hover:shadow-sm",
                            isActivePreview
                              ? "border-[#0073EA] bg-[#F5FAFF]"
                              : "border-[#E6E9EF] bg-white",
                          )}
                        >
                          <p className="text-sm font-bold text-[#323338]">Version {versionNumber}</p>
                          <p className="mt-1 text-xs text-[#676879]">{version.commitMessage}</p>
                          <p className="mt-1 text-xs text-[#676879]">
                            {formatVersionTimestamp(version.timestamp)}
                          </p>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleRestoreVersion(version);
                            }}
                            className="absolute top-3 right-3 hidden rounded-md px-2 py-1 text-xs font-semibold text-[#0073EA] hover:bg-[#F5F6F8] group-hover:block"
                          >
                            Restore
                          </button>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
