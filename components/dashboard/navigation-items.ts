import { ArrowRightLeft, CalendarDays, CirclePlus, LayoutDashboard, Link2, ListChecks, ListTree, Trophy, UsersRound, type LucideIcon } from "lucide-react";

export type NavigationItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
};

export const NAVIGATION_ITEMS: NavigationItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/players", label: "Players", icon: UsersRound },
  { href: "/waivers", label: "Waiver Wire", icon: CirclePlus },
  { href: "/league-matchups", label: "League Schedule", icon: CalendarDays },
  { href: "/matchups", label: "Matchups", icon: CalendarDays },
  { href: "/start-sit", label: "Start / Sit", icon: ListChecks },
  { href: "/season", label: "Season Outlook", icon: Trophy },
  { href: "/depth-charts", label: "Depth Charts", icon: ListTree },
  { href: "/trades", label: "Trade Finder", icon: ArrowRightLeft },
  { href: "/dashboard/connect", label: "Connect League", icon: Link2 },
];

export function isNavigationActive(pathname: string, item: Pick<NavigationItem, "href" | "exact">) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}
