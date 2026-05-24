"use client";

import {
  Document,
  Image as PdfImage,
  Page,
  StyleSheet,
  Text,
  View,
  pdf,
} from "@react-pdf/renderer";
import type { InvoiceDocumentAiBody, QuoteDocumentAiBody } from "@/lib/ai/document-body-shared";
import type { DocumentRefinementPayload } from "@/lib/document-refinement-payload";
import type { Client, Job, LineItem, UserSettings } from "@/types/database";

type DocumentType = "quote" | "invoice";

function formatCurrency(valueCents: number) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format(valueCents / 100);
}

function formatAddress(address?: Client["billingAddress"] | Job["billingAddress"]) {
  if (!address) {
    return [];
  }

  const locality = [address.suburb, address.state, address.postcode].filter(Boolean).join(" ");
  return [address.line1, address.line2, locality, address.country].filter(Boolean) as string[];
}

function buildPdfStyles(
  accentColor: string,
  bodySize: number,
  headingSize: number,
  primaryTextColor: string,
) {
  return StyleSheet.create({
    page: {
      backgroundColor: "#ffffff",
      color: primaryTextColor,
      fontSize: bodySize,
      paddingTop: 32,
      paddingBottom: 32,
      paddingHorizontal: 32,
      fontFamily: "Helvetica",
    },
    header: {
      display: "flex",
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      marginBottom: 24,
      borderBottomWidth: 1,
      borderBottomColor: "#d4d4d8",
      paddingBottom: 14,
    },
    businessTitle: {
      fontSize: headingSize,
      fontWeight: 700,
      color: accentColor,
      marginBottom: 4,
    },
    blockTitle: {
      fontSize: bodySize + 1,
      fontWeight: 700,
      marginBottom: 6,
      color: accentColor,
    },
    section: {
      marginBottom: 18,
    },
    row: {
      display: "flex",
      flexDirection: "row",
      justifyContent: "space-between",
      gap: 10,
      marginBottom: 4,
    },
    tableHeader: {
      display: "flex",
      flexDirection: "row",
      borderBottomWidth: 1,
      borderBottomColor: accentColor,
      paddingBottom: 6,
      marginBottom: 6,
      fontWeight: 700,
    },
    tableRow: {
      display: "flex",
      flexDirection: "row",
      borderBottomWidth: 1,
      borderBottomColor: "#e4e4e7",
      paddingVertical: 6,
    },
    descriptionCol: {
      flexGrow: 1,
      width: "52%",
      paddingRight: 8,
    },
    qtyCol: {
      width: "12%",
      textAlign: "right",
    },
    rateCol: {
      width: "16%",
      textAlign: "right",
    },
    totalCol: {
      width: "20%",
      textAlign: "right",
    },
    laborDescCol: {
      flexGrow: 1,
      width: "46%",
      paddingRight: 8,
    },
    laborHoursCol: {
      width: "12%",
      textAlign: "right",
    },
    laborRateCol: {
      width: "18%",
      textAlign: "right",
    },
    laborAmtCol: {
      width: "18%",
      textAlign: "right",
    },
    totalsPanel: {
      marginLeft: "auto",
      width: 220,
      marginTop: 8,
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: accentColor,
    },
    bigTotal: {
      fontSize: headingSize,
      fontWeight: 700,
      color: accentColor,
      marginTop: 10,
    },
  });
}

function GeneratedDocumentPdf(props: {
  job: Job;
  client: Client;
  settings: UserSettings;
  lineItems: LineItem[];
  documentType: DocumentType;
  documentNumber: string;
  subtotalCents: number;
  markupCents: number;
  markupPercent: number;
  taxCents: number;
  totalCents: number;
  groupLaborAndMaterialsSeparately: boolean;
  accentColor: string;
  bodySize: number;
  headingSize: number;
  showLargeTotal: boolean;
  primaryTextColor: string;
  quoteBody?: QuoteDocumentAiBody | null;
  invoiceBody?: InvoiceDocumentAiBody | null;
}) {
  const styles = buildPdfStyles(
    props.accentColor,
    props.bodySize,
    props.headingSize,
    props.primaryTextColor,
  );

  const grouped = props.groupLaborAndMaterialsSeparately
    ? [
        { label: "Labor", items: props.lineItems.filter((item) => item.kind === "labor") },
        { label: "Materials", items: props.lineItems.filter((item) => item.kind !== "labor") },
      ]
    : [{ label: "Items", items: props.lineItems }];

  const showQuoteAi = props.documentType === "quote" && props.quoteBody;
  const showInvoiceAi = props.documentType === "invoice" && props.invoiceBody;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.businessTitle}>{props.settings.businessProfile.businessName || "Business"}</Text>
            <Text>ABN/ACN: {props.settings.businessProfile.abnOrAcn}</Text>
            {formatAddress(props.settings.businessProfile.address).map((line) => (
              <Text key={line}>{line}</Text>
            ))}
            <Text>{props.settings.businessProfile.bankName}</Text>
            <Text>
              BSB {props.settings.businessProfile.bsb} | Account {props.settings.businessProfile.accountNumber}
            </Text>
          </View>
          <View>
            {props.settings.businessProfile.logoUrl ? (
              <PdfImage
                src={props.settings.businessProfile.logoUrl}
                style={{ width: 110, height: 54, objectFit: "contain" }}
              />
            ) : null}
            <Text style={{ marginTop: 12, fontWeight: 700, color: props.accentColor }}>
              {props.documentType === "invoice" ? "INVOICE" : "QUOTE"}
            </Text>
            <Text>{props.documentNumber}</Text>
          </View>
        </View>

        {showInvoiceAi ? (
          <View style={styles.section}>
            <Text style={{ fontSize: props.bodySize, lineHeight: 1.45 }}>{props.invoiceBody!.billingIntroduction}</Text>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.blockTitle}>Client</Text>
          <Text>{props.client.displayName}</Text>
          {props.client.email ? <Text>{props.client.email}</Text> : null}
          {formatAddress(props.client.billingAddress).map((line) => (
            <Text key={line}>{line}</Text>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.blockTitle}>Project</Text>
          <Text>{props.job.title}</Text>
          {props.job.description ? <Text>{props.job.description}</Text> : null}
        </View>

        {showQuoteAi ? (
          <>
            <View style={styles.section}>
              <Text style={{ lineHeight: 1.45 }}>{props.quoteBody!.introduction}</Text>
            </View>
            {props.quoteBody!.phases.map((phase, idx) => (
              <View key={`${phase.phaseName}-${idx}`} style={styles.section}>
                <Text style={[styles.blockTitle, { marginBottom: 8 }]}>{phase.phaseName}</Text>
                <View style={styles.tableHeader}>
                  <Text style={styles.descriptionCol}>Description</Text>
                  <Text style={styles.qtyCol}>Qty</Text>
                  <Text style={styles.rateCol}>Rate</Text>
                  <Text style={styles.totalCol}>Amount</Text>
                </View>
                {phase.lineItems.map((row, ridx) => (
                  <View key={`${phase.phaseName}-row-${ridx}`} style={styles.tableRow}>
                    <Text style={styles.descriptionCol}>{row.description}</Text>
                    <Text style={styles.qtyCol}>{row.quantity}</Text>
                    <Text style={styles.rateCol}>{formatCurrency(row.unitPriceCents)}</Text>
                    <Text style={styles.totalCol}>{formatCurrency(row.subtotalCents)}</Text>
                  </View>
                ))}
              </View>
            ))}
          </>
        ) : showInvoiceAi ? (
          <>
            {props.invoiceBody!.categorizedLineItems.labor.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.blockTitle}>Labour</Text>
                <View style={styles.tableHeader}>
                  <Text style={styles.laborDescCol}>Description</Text>
                  <Text style={styles.laborHoursCol}>Hours</Text>
                  <Text style={styles.laborRateCol}>Rate</Text>
                  <Text style={styles.laborAmtCol}>Amount</Text>
                </View>
                {props.invoiceBody!.categorizedLineItems.labor.map((row, ridx) => (
                  <View key={`labor-${ridx}`} style={styles.tableRow}>
                    <Text style={styles.laborDescCol}>{row.description}</Text>
                    <Text style={styles.laborHoursCol}>{row.hours}</Text>
                    <Text style={styles.laborRateCol}>{formatCurrency(row.hourlyRateCents)}</Text>
                    <Text style={styles.laborAmtCol}>{formatCurrency(row.subtotalCents)}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            {props.invoiceBody!.categorizedLineItems.materials.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.blockTitle}>Materials</Text>
                <View style={styles.tableHeader}>
                  <Text style={styles.descriptionCol}>Description</Text>
                  <Text style={styles.qtyCol}>Qty</Text>
                  <Text style={styles.rateCol}>Rate</Text>
                  <Text style={styles.totalCol}>Amount</Text>
                </View>
                {props.invoiceBody!.categorizedLineItems.materials.map((row, ridx) => (
                  <View key={`mat-${ridx}`} style={styles.tableRow}>
                    <Text style={styles.descriptionCol}>{row.description}</Text>
                    <Text style={styles.qtyCol}>{row.quantity}</Text>
                    <Text style={styles.rateCol}>{formatCurrency(row.unitPriceCents)}</Text>
                    <Text style={styles.totalCol}>{formatCurrency(row.subtotalCents)}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </>
        ) : (
          grouped.map((group) => {
            if (group.items.length === 0) {
              return null;
            }

            return (
              <View key={group.label} style={styles.section}>
                <Text style={styles.blockTitle}>{group.label}</Text>
                <View style={styles.tableHeader}>
                  <Text style={styles.descriptionCol}>Description</Text>
                  <Text style={styles.qtyCol}>Qty</Text>
                  <Text style={styles.rateCol}>Rate</Text>
                  <Text style={styles.totalCol}>Amount</Text>
                </View>
                {group.items.map((item) => (
                  <View key={item.id} style={styles.tableRow}>
                    <Text style={styles.descriptionCol}>{item.description}</Text>
                    <Text style={styles.qtyCol}>{item.quantity}</Text>
                    <Text style={styles.rateCol}>{formatCurrency(item.unitPriceCents)}</Text>
                    <Text style={styles.totalCol}>{formatCurrency(item.subtotalCents)}</Text>
                  </View>
                ))}
              </View>
            );
          })
        )}

        <View style={styles.totalsPanel}>
          <View style={styles.row}>
            <Text>Subtotal</Text>
            <Text>{formatCurrency(props.subtotalCents)}</Text>
          </View>
          <View style={styles.row}>
            <Text>Materials markup ({props.markupPercent}%)</Text>
            <Text>{formatCurrency(props.markupCents)}</Text>
          </View>
          <View style={styles.row}>
            <Text>GST</Text>
            <Text>{formatCurrency(props.taxCents)}</Text>
          </View>
          {showInvoiceAi ? (
            <Text
              style={{
                marginTop: 8,
                fontSize: props.bodySize - 1,
                color: "#374151",
                lineHeight: 1.45,
              }}
            >
              {props.invoiceBody!.gstSummaryStatement}
            </Text>
          ) : null}
          {props.showLargeTotal ? (
            <Text style={styles.bigTotal}>Total {formatCurrency(props.totalCents)}</Text>
          ) : (
            <View style={styles.row}>
              <Text>Total</Text>
              <Text>{formatCurrency(props.totalCents)}</Text>
            </View>
          )}
        </View>

        {showQuoteAi ? (
          <View style={{ marginTop: 14 }}>
            <Text style={{ lineHeight: 1.45 }}>{props.quoteBody!.closingStatement}</Text>
          </View>
        ) : null}

        <View style={{ marginTop: 20 }}>
          <Text>Payment terms: {props.settings.businessProfile.paymentTerms}</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function compileDocumentPdfFromPayload(
  payload: DocumentRefinementPayload,
): Promise<Blob> {
  const accentColor = payload.themeOverrides?.accentColor ?? payload.accentColor;
  const primaryTextColor = payload.themeOverrides?.primaryTextColor ?? "#323338";

  return pdf(
    <GeneratedDocumentPdf
      job={payload.job}
      client={payload.client}
      settings={payload.settings}
      lineItems={payload.lineItems}
      documentType={payload.documentType}
      documentNumber={payload.documentNumber}
      subtotalCents={payload.subtotalCents}
      markupCents={payload.markupCents}
      markupPercent={payload.markupPercent}
      taxCents={payload.taxCents}
      totalCents={payload.totalCents}
      groupLaborAndMaterialsSeparately={payload.groupLaborAndMaterialsSeparately}
      accentColor={accentColor}
      primaryTextColor={primaryTextColor}
      bodySize={payload.bodySize}
      headingSize={payload.headingSize}
      showLargeTotal={payload.showLargeTotal}
      quoteBody={payload.quoteBody}
      invoiceBody={payload.invoiceBody}
    />,
  ).toBlob();
}
