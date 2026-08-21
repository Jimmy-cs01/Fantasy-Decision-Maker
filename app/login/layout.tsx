import { privatePageMetadata } from "@/lib/seo/metadata";

export const metadata = privatePageMetadata("Log In");

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
