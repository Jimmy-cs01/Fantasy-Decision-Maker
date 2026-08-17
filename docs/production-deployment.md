# Production deployment: jimmygm.com

The canonical production origin is `https://jimmygm.com`. `www.jimmygm.com` is an alternate hostname that permanently redirects to the apex domain. Vercel preview URLs may be allowlisted for testing, but they are never canonical metadata or authentication email targets.

## 1. Vercel project and domain setup

1. Open Vercel, select the Jim's Fantasy Helper project, then open **Settings → Domains**.
2. Add `jimmygm.com` and `www.jimmygm.com`.
3. For each domain, use the exact **A**, **CNAME**, or ownership **TXT** record Vercel displays. Do not substitute a remembered or generic Vercel target.
4. In Namecheap, open **Domain List → Manage jimmygm.com → Advanced DNS**. Under **Host Records**, add the exact Vercel records:
   - Apex/root records use Host `@`.
   - The `www.jimmygm.com` record uses Host `www`.
   - Enter any verification TXT record exactly as Vercel displays it.
5. Back in Vercel Domains, set `jimmygm.com` as the production/primary domain.
6. Edit `www.jimmygm.com` and set **Redirect to → jimmygm.com**. The application itself always emits apex-domain URLs.
7. Under **Settings → Environment Variables**, add `NEXT_PUBLIC_SITE_URL` with value `https://jimmygm.com` for **Production**. Do not set a preview deployment URL as the production value.
8. Redeploy the production deployment so Next.js metadata and server actions receive the new variable.

If Namecheap Advanced DNS cannot be edited, first verify that the domain uses Namecheap BasicDNS, PremiumDNS, or FreeDNS. If it uses third-party nameservers, make the records at that authoritative DNS provider instead.

## 2. Supabase Auth URL configuration

In the Supabase project, open **Authentication → URL Configuration** and set:

```text
Site URL
https://jimmygm.com

Redirect URLs
https://jimmygm.com/**
https://www.jimmygm.com/**
http://localhost:3000/**
http://localhost:3001/**
```

Only add a Vercel preview wildcard if preview authentication is genuinely needed. Keep the Site URL and Vercel Production `NEXT_PUBLIC_SITE_URL` set to `https://jimmygm.com`.

Signup confirmation and password recovery explicitly use `https://jimmygm.com/auth/callback` in production. If customized Supabase email templates use `{{ .SiteURL }}` directly, update their destination to honor `{{ .RedirectTo }}` or use Supabase's generated confirmation URL so the explicit redirect is retained.

## 3. Verify jimmygm.com in Resend

In Resend, open **Domains**, add `jimmygm.com`, and copy the records shown for that domain. For the current configuration, add these records in Namecheap under **Domain List → Manage jimmygm.com → Advanced DNS**:

| Purpose             | Type | Host                | Value                                     | Priority | TTL       |
| ------------------- | ---- | ------------------- | ----------------------------------------- | -------- | --------- |
| DKIM                | TXT  | `resend._domainkey` | Full public-key value displayed by Resend | —        | Automatic |
| SPF return path     | MX   | `send`              | `feedback-smtp.us-east-1.amazonses.com`   | `10`     | Automatic |
| SPF                 | TXT  | `send`              | `v=spf1 include:amazonses.com ~all`       | —        | Automatic |
| DMARC (recommended) | TXT  | `_dmarc`            | `v=DMARC1; p=none;`                       | —        | Automatic |

For TXT records, click **Add New Record → TXT Record**, enter only `resend._domainkey`, `send`, or `_dmarc` in the Host field, paste the corresponding value, and leave TTL on Automatic.

For the Resend MX record, add an **MX Record** with Host `send`, the Resend target, and priority `10`. Namecheap may expose third-party MX entry after selecting **Mail Settings → Custom MX**. The required record belongs to `send.jimmygm.com`, not the root domain. If the Custom MX screen only permits root-domain MX entries and does not provide a Host field, do not replace unrelated root mail records; use Namecheap support or the authoritative DNS editor to add the subdomain MX correctly. Do not delete existing root-domain mail records merely to add Resend's return path.

After saving, return to Resend and click **Verify DNS Records**. DNS verification often takes several minutes but can take longer while caches expire. Use the exact DKIM value currently displayed by Resend rather than an example key.

## 4. Supabase Custom SMTP using Resend

After the Resend domain is verified, create or select a Resend sending API key. Enter it only in Supabase; never add it to Vercel, `.env.local`, source code, logs, or documentation.

Open **Supabase → Authentication → Emails → SMTP Settings** (the dashboard label may appear as Custom SMTP), enable it, and enter:

```text
Sender email: no-reply@jimmygm.com
Sender name: Jim's Fantasy Helper
Host: smtp.resend.com
Port: 465
Username: resend
Password: <Resend API key entered manually>
```

The sender address does not need to be an inbox unless the provider separately requires one; domain verification authorizes sending. Resend remains an SMTP provider only—Supabase Auth generates and sends confirmation, recovery, and other authentication messages.

## 5. Production verification checklist

1. Add `jimmygm.com` and `www.jimmygm.com` in Vercel.
2. Add Vercel's displayed records in Namecheap.
3. Set `jimmygm.com` as primary in Vercel.
4. Redirect `www.jimmygm.com` to `jimmygm.com` in Vercel.
5. Set Vercel Production `NEXT_PUBLIC_SITE_URL=https://jimmygm.com`.
6. Redeploy production.
7. Configure the Supabase Site URL and redirect allowlist above.
8. Add and begin verifying `jimmygm.com` in Resend.
9. Add Resend DKIM, MX/SPF, SPF TXT, and DMARC records in Namecheap.
10. Wait until Resend reports the domain verified.
11. Create or select a Resend sending API key.
12. Configure Supabase Custom SMTP using the settings above.
13. Test signup using an external email address not attached to the Supabase organization.
14. Confirm the email link returns to `https://jimmygm.com/auth/callback` and finishes at the intended internal page.
15. Test login at `https://jimmygm.com/login`.
16. Test **Forgot password** through the complete recovery and password-update flow.
