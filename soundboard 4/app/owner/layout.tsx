import Link from "next/link";
import type React from "react";
import { createClient } from "@/lib/supabase-server";
import QuickAdd from "./quick-add";

const links = [
  { href: "/owner/clients", label: "Clients" },
  { href: "/owner/pianos", label: "Pianos" },
  { href: "/owner/leads", label: "Leads" },
  { href: "/owner/estimates", label: "Estimates" },
  { href: "/owner/services", label: "Services" },
  { href: "/owner/jobs", label: "Jobs" },
  { href: "/owner/invoices", label: "Invoices" },
  { href: "/owner/availability", label: "Availability" },
  { href: "/owner/buysell", label: "Buy/Sell" },
  { href: "/owner/documents", label: "Documents" },
  { href: "/owner/import", label: "Import" },
];

export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  // Only id+name for the quick-add piano form's client picker — this runs
  // on every owner page via the layout, so keeping it minimal matters more
  // here than almost anywhere else in the app.
  const { data: clients } = await supabase.from("clients").select("id, name").order("name");

  return (
    <div>
      <nav style={{ display: "flex", alignItems: "center", gap: 18, padding: "14px 24px", borderBottom: "1px solid #ddd", fontSize: 14 }}>
        {links.map((l) => (
          <Link key={l.href} href={l.href}>{l.label}</Link>
        ))}
        <QuickAdd clients={clients ?? []} />
      </nav>
      {children}
    </div>
  );
}
