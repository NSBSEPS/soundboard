import type { Metadata } from "next";
import type React from "react";

export const metadata: Metadata = {
  title: "Soundboard",
  description: "Piano service business platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif" }}>{children}</body>
    </html>
  );
}
