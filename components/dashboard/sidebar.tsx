"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogIn, LogOut, Menu, Save, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { signOut } from "@/app/auth/actions";
import { BrandLogo } from "@/components/brand/brand-logo";
import { guestLeagueHref } from "@/lib/guest/session";
import { useGuestSession } from "@/lib/guest/use-guest-session";
import { isNavigationActive, NAVIGATION_ITEMS } from "./navigation-items";

export function Sidebar({ guest = false, guestView }: { guest?: boolean; guestView?: string }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const guestSession = useGuestSession();
  const guestLeagueId = guest ? guestSession?.selectedLeagueId ?? null : null;
  const selectedGuestLeague = guestSession?.leagues.find((league) => league.leagueId === guestLeagueId) ?? null;
  const guestDashboardHref = guestLeagueId ? guestLeagueHref(guestLeagueId) : "/guest";
  const guestSignupHref = guestSession
    ? `/signup?next=${encodeURIComponent(`/dashboard/connect?guestUsername=${encodeURIComponent(guestSession.sleeperUsername)}${guestLeagueId ? `&guestLeagueId=${encodeURIComponent(guestLeagueId)}` : ""}`)}`
    : "/signup?next=%2Fdashboard%2Fconnect";
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const closeMenu = useCallback((restoreFocus = true) => {
    setMenuOpen(false);
    if (restoreFocus) requestAnimationFrame(() => menuButtonRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [closeMenu, menuOpen]);

  const trapDrawerFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const focusable = drawerRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])');
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return <>
    <header className="flex items-center justify-between border-b border-slate-800 bg-slate-950/90 px-4 py-3 md:hidden">
      <Link href={guest ? guestDashboardHref : "/dashboard"} aria-label="Jimmy GM dashboard" className="font-black text-cyan-300"><BrandLogo size={24} wordmarkClassName="text-slate-100" /></Link>
      <button
        ref={menuButtonRef}
        type="button"
        aria-label="Open navigation menu"
        aria-expanded={menuOpen}
        aria-controls="mobile-navigation-drawer"
        onClick={() => setMenuOpen(true)}
        className="rounded-lg border border-slate-700 p-2 text-slate-200 transition hover:border-cyan-400/60 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
      ><Menu size={22} /></button>
    </header>

    {menuOpen ? <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm md:hidden" onMouseDown={(event) => { if (event.target === event.currentTarget) closeMenu(); }}>
      <div
        ref={drawerRef}
        id="mobile-navigation-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Main navigation"
        onKeyDown={trapDrawerFocus}
        className="ml-auto flex h-full w-[min(20rem,88vw)] flex-col border-l border-slate-800 bg-slate-950 p-4 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <span className="font-black text-slate-100">Navigation</span>
          <button ref={closeButtonRef} type="button" aria-label="Close navigation menu" onClick={() => closeMenu()} className="rounded-lg p-2 text-slate-300 hover:bg-slate-800 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"><X size={22} /></button>
        </div>
        <NavigationLinks pathname={pathname} guest={guest} guestLeagueId={guestLeagueId} guestView={guestView} onSelect={() => closeMenu(false)} className="mt-4 flex flex-col gap-1" />
        {guest ? <GuestAccountPanel leagueName={selectedGuestLeague?.name} season={selectedGuestLeague?.season} username={guestSession?.sleeperUsername} switchHref="/guest" signupHref={guestSignupHref} className="mt-auto border-t border-slate-800 pt-4" /> : <form className="mt-auto border-t border-slate-800 pt-4"><button formAction={signOut} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-bold text-slate-300 hover:bg-slate-800 hover:text-white"><LogOut size={18} /> Sign out</button></form>}
      </div>
    </div> : null}

    <aside className="hidden min-h-screen w-60 flex-col border-r border-slate-800 bg-slate-950/60 p-4 md:flex">
      <Link href={guest ? guestDashboardHref : "/dashboard"} aria-label="Jimmy GM dashboard" className="font-black text-cyan-300"><BrandLogo size={24} wordmarkClassName="text-slate-100" /></Link>
      <NavigationLinks pathname={pathname} guest={guest} guestLeagueId={guestLeagueId} guestView={guestView} className="mt-10 flex flex-col gap-1" />
      {guest ? <GuestAccountPanel leagueName={selectedGuestLeague?.name} season={selectedGuestLeague?.season} username={guestSession?.sleeperUsername} switchHref="/guest" signupHref={guestSignupHref} className="mt-auto" /> : <form className="mt-auto"><button formAction={signOut} className="flex items-center gap-2 text-sm text-slate-400 hover:text-white"><LogOut size={16} /> Sign out</button></form>}
    </aside>
  </>;
}

function guestHref(href: string, leagueId: string | null) {
  if (["/players", "/matchups", "/depth-charts"].includes(href)) return href;
  if (!leagueId && ["/trades", "/start-sit"].includes(href)) return href;
  if (!leagueId) return "/guest";
  if (href === "/dashboard") return guestLeagueHref(leagueId);
  if (href === "/trades") return guestLeagueHref(leagueId, "trades");
  if (href === "/start-sit") return guestLeagueHref(leagueId, "start-sit");
  if (href === "/season") return guestLeagueHref(leagueId, "season");
  if (href === "/dashboard/connect") return "/guest";
  return href;
}

function NavigationLinks({ pathname, className, onSelect, guest, guestLeagueId, guestView }: { pathname: string; className: string; onSelect?: () => void; guest: boolean; guestLeagueId: string | null; guestView?: string }) {
  const items = guest ? NAVIGATION_ITEMS.filter((item) => item.href !== "/dashboard/connect") : NAVIGATION_ITEMS;
  return <nav aria-label="Main navigation" className={className}>{items.map((item) => {
    const Icon = item.icon;
    const active = guest && pathname.startsWith("/guest/league/")
      ? (item.href === "/dashboard" && (!guestView || guestView === "overview"))
        || (item.href === "/trades" && guestView === "trades")
        || (item.href === "/start-sit" && guestView === "start-sit")
        || (item.href === "/season" && guestView === "season")
      : isNavigationActive(pathname, item);
    return <Link
      key={item.href}
      href={guest ? guestHref(item.href, guestLeagueId) : item.href}
      aria-current={active ? "page" : undefined}
      onClick={onSelect}
      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 ${active ? "bg-cyan-400/15 text-cyan-200" : "text-slate-300 hover:bg-slate-800/80 hover:text-white"}`}
    ><Icon size={17} /> {item.label}</Link>;
  })}</nav>;
}

function GuestAccountPanel({ leagueName, season, username, switchHref, signupHref, className }: {
  leagueName?: string;
  season?: string;
  username?: string;
  switchHref: string;
  signupHref: string;
  className: string;
}) {
  return <section aria-label="Guest account" className={className}>
    <p className="text-[10px] font-black uppercase tracking-[.18em] text-amber-200">Guest Session</p>
    <p className="mt-1 truncate text-sm font-bold text-slate-100">{leagueName ?? "Sleeper league"}</p>
    <p className="truncate text-xs text-slate-500">{username ? `@${username}` : "Temporary session"}{season ? ` · ${season}` : ""}</p>
    <div className="mt-3 space-y-1">
      <Link href={switchHref} className="flex items-center gap-2 rounded-lg px-2 py-2 text-xs font-bold text-slate-400 hover:bg-slate-800 hover:text-white"><LogIn size={15} /> Switch league</Link>
      <Link href={signupHref} className="flex items-center gap-2 rounded-lg px-2 py-2 text-xs font-black text-cyan-300 hover:bg-cyan-400/10"><Save size={15} /> Sign Up / Save League</Link>
    </div>
  </section>;
}
