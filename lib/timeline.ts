// Display metadata for every `kind` the client_timeline view can emit.
// `group` drives the filter chips; `attention` kinds get the red accent.
export type TimelineGroup = "notes" | "communication" | "email" | "work" | "billing";

export const KIND_META: Record<string, { label: string; group: TimelineGroup; attention?: boolean }> = {
  note: { label: "Note", group: "notes" },
  document: { label: "Document", group: "notes" },
  call: { label: "Call", group: "communication" },
  text: { label: "Text", group: "communication" },
  email: { label: "Email", group: "communication" },
  in_person: { label: "In person", group: "communication" },
  other: { label: "Other", group: "notes" },
  reminder_sent: { label: "Reminder sent", group: "email" },
  email_opened: { label: "Email opened", group: "email" },
  email_bounced: { label: "Email bounced", group: "email", attention: true },
  email_complained: { label: "Spam report", group: "email", attention: true },
  unsubscribed: { label: "Unsubscribed", group: "email", attention: true },
  service: { label: "Service", group: "work" },
  appointment: { label: "Appointment", group: "work" },
  work_completed: { label: "Work completed", group: "work" },
  measurement: { label: "Measurements", group: "work" },
  estimate_sent: { label: "Estimate sent", group: "billing" },
  estimate_accepted: { label: "Estimate accepted", group: "billing" },
  estimate_declined: { label: "Estimate declined", group: "billing" },
  invoice_sent: { label: "Invoice sent", group: "billing" },
  invoice_paid: { label: "Invoice paid", group: "billing" },
};

export const GROUP_LABELS: Record<"all" | TimelineGroup, string> = {
  all: "Everything",
  communication: "Calls & visits",
  email: "Email activity",
  work: "Service & work",
  billing: "Estimates & invoices",
  notes: "Notes & records",
};

export function kindsInGroup(group: TimelineGroup) {
  return Object.entries(KIND_META).filter(([, m]) => m.group === group).map(([k]) => k);
}

// Where a timeline row should link to, or null if there's no useful page.
export function linkFor(row: { source_table: string; source_id: string; piano_id: string | null }) {
  switch (row.source_table) {
    case "estimates": return `/owner/estimates/${row.source_id}`;
    case "invoices": return `/owner/invoices/${row.source_id}`;
    case "documents": return "/owner/documents";
    case "proposed_work": return "/owner/jobs";
    case "service_records":
    case "piano_measurements": return row.piano_id ? `/owner/pianos/${row.piano_id}` : null;
    default: return null;
  }
}
