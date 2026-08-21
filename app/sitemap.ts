import type { MetadataRoute } from "next";
import { CANONICAL_SITE_URL } from "@/lib/site-url";

const PUBLIC_ROUTES = ["/", "/players", "/trades", "/start-sit", "/matchups", "/depth-charts"] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_ROUTES.map((path) => ({
    url: `${CANONICAL_SITE_URL}${path}`,
    changeFrequency: path === "/" ? "weekly" : "daily",
    priority: path === "/" ? 1 : 0.8,
  }));
}
