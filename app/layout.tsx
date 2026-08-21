import type { Metadata, Viewport } from "next";
import { CANONICAL_SITE_URL } from "@/lib/site-url";
import "./globals.css";
import { AnalyticsTracker } from "@/components/analytics/analytics-tracker";
import { WebsiteStructuredData } from "@/components/seo/website-structured-data";

const title = "JimmyGM — Fantasy Football Trade Finder, Projections & Start/Sit Tools";
const description =
  "Use JimmyGM for fantasy football projections, Player Values, Trade Finder, Start/Sit decisions, matchups, and read-only Sleeper league analysis.";

export const metadata: Metadata = {
  metadataBase: new URL(CANONICAL_SITE_URL),
  applicationName: "JimmyGM",
  title: { default: title, template: "%s | JimmyGM" },
  description,
  keywords: ["JimmyGM", "Jimmy GM", "fantasy football trade analyzer", "fantasy football trade finder", "fantasy football projections", "fantasy football start sit", "Sleeper fantasy football tools", "fantasy football player values"],
  creator: "JimmyGM",
  publisher: "JimmyGM",
  category: "sports",
  alternates: { canonical: "/" },
  manifest: "/manifest.webmanifest",
  icons: { icon: [{ url: "/icon.svg", type: "image/svg+xml" }], apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }] },
  openGraph: { title, description, type: "website", url: "/", siteName: "JimmyGM", locale: "en_US" },
  twitter: { card: "summary_large_image", title, description },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 } },
  appleWebApp: { capable: true, title: "JimmyGM", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = { themeColor: "#020617", colorScheme: "dark" };

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><WebsiteStructuredData /><AnalyticsTracker />{children}</body>
    </html>
  );
}
