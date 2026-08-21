import type { Metadata } from "next";

export function publicPageMetadata(title: string, description: string, canonical: string): Metadata {
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title: `${title} | JimmyGM`, description, url: canonical, siteName: "JimmyGM", type: "website", locale: "en_US" },
    twitter: { card: "summary_large_image", title: `${title} | JimmyGM`, description },
  };
}

export function privatePageMetadata(title: string): Metadata {
  return { title, robots: { index: false, follow: false, noarchive: true, nosnippet: true } };
}
