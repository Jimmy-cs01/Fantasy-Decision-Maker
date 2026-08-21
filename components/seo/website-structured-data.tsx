import { CANONICAL_SITE_URL } from "@/lib/site-url";

const website = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "JimmyGM",
  alternateName: "Jimmy GM",
  url: CANONICAL_SITE_URL,
  applicationCategory: "SportsApplication",
  operatingSystem: "Web",
  description: "Fantasy football projections, player values, trade analysis, Start/Sit comparisons, matchups, and Sleeper league tools.",
  featureList: ["Fantasy football projections", "Trade Finder", "Start / Sit comparisons", "Player Values", "Sleeper league analysis"],
};

export function WebsiteStructuredData() {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(website).replace(/</g, "\\u003c") }} />;
}
