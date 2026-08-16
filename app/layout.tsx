import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Jim's Fantasy Helper", template: "%s | Jim's Fantasy Helper" },
  description: "Fantasy football statistics, synced league insights, and decision support.",
  openGraph: { title: "Jim's Fantasy Helper", description: "Fantasy football statistics, synced league insights, and decision support.", type: "website" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
