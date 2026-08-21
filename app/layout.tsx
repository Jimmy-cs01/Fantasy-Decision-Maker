import type { Metadata } from "next";
import { getSiteUrl } from "@/lib/site-url";
import "./globals.css";
import { GuestAnalyticsTracker } from "@/components/analytics/guest-analytics-tracker";

const title = "Jimmy GM";
const description =
  "Fantasy football statistics, synced league insights, and decision support.";

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: { default: title, template: `%s | ${title}` },
  description,
  alternates: { canonical: "/" },
  openGraph: { title, description, type: "website", url: "/", siteName: title },
  twitter: { card: "summary_large_image", title, description },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><GuestAnalyticsTracker />{children}</body>
    </html>
  );
}
