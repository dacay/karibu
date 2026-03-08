"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Dna,
  BookOpen,
  UserCircle,
  MessageSquare,
  Users,
  Building2,
  ChevronDown,
  Sun,
  Moon,
  Monitor,
  Flag,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useQuery } from "@tanstack/react-query";

import Image from "next/image";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { useLogo } from "@/hooks/useLogo";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Spinner } from "@/components/ui/spinner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { DashboardSection } from "./sections/Dashboard";
import { DNASection } from "./sections/DNA";
import { MicrolearningsSection } from "./sections/Microlearnings";
import { AvatarsSection } from "./sections/Avatars";
import { PatternsSection } from "./sections/Patterns";
import { TeamSection } from "./sections/Team";
import { OrganizationSection } from "./sections/Organization";
import { FlaggedMessagesSection } from "./sections/FlaggedMessages";

type SectionId = "dashboard" | "dna" | "microlearnings" | "avatars" | "patterns" | "team" | "organization" | "flagged";

const NAV_ITEMS: { id: SectionId; label: string; icon: React.ElementType }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "dna", label: "Source", icon: Dna },
  { id: "microlearnings", label: "Microlearnings", icon: BookOpen },
  { id: "avatars", label: "Avatars", icon: UserCircle },
  { id: "patterns", label: "Patterns", icon: MessageSquare },
  { id: "team", label: "Team", icon: Users },
  { id: "organization", label: "Organization", icon: Building2 },
  { id: "flagged", label: "Flagged", icon: Flag },
];

function getInitials(email: string): string {
  const [local] = email.split("@");
  const parts = local.split(/[._-]/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return local.slice(0, 2).toUpperCase();
}

const APPEARANCE_OPTIONS: { value: string; label: string; icon: React.ElementType }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

export function AdminRoot() {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const { lightSrc, darkSrc, isLoading, onLightError, onDarkError } = useLogo();
  const pathname = usePathname();
  const router = useRouter();

  const activeSection: SectionId = NAV_ITEMS.find((item) => item.id !== "dashboard" && `/${item.id}` === pathname)?.id ?? "dashboard";

  const { data: flagCount } = useQuery({
    queryKey: ["flags", "count"],
    queryFn: api.flags.count,
    refetchInterval: 60_000,
  });

  const openFlagCount = flagCount?.count ?? 0;

  const initials = user?.email ? getInitials(user.email) : "?";

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <aside className="flex w-56 shrink-0 flex-col border-r bg-sidebar">
        <div className="flex h-[4.5rem] items-center justify-center px-5 border-b border-sidebar-border">
          {isLoading ? (
            <Spinner />
          ) : (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <Image
                      src={lightSrc}
                      alt="Logo"
                      width={96}
                      height={32}
                      className="block dark:hidden"
                      onError={onLightError}
                      unoptimized
                      priority
                    />
                    <Image
                      src={darkSrc}
                      alt="Logo"
                      width={96}
                      height={32}
                      className="hidden dark:block"
                      onError={onDarkError}
                      unoptimized
                      priority
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {user?.organizationName}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
            const isActive = activeSection === id;
            const showFlagBadge = id === "flagged" && openFlagCount > 0;
            return (
              <button
                key={id}
                onClick={() => router.push(id === "dashboard" ? "/" : `/${id}`)}
                className={[
                  "flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                ].join(" ")}
              >
                <Icon className={["size-4 shrink-0", showFlagBadge ? "text-destructive" : ""].join(" ")} />
                <span className="flex-1 text-left">{label}</span>
                {showFlagBadge && (
                  <span className="rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-bold leading-none text-destructive-foreground">
                    {openFlagCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

      </aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Top bar */}
        <header className="flex h-14 shrink-0 items-center justify-end border-b px-6">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="flex items-center gap-2 h-9 px-2">
                <Avatar className="size-7">
                  <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                </Avatar>
                <ChevronDown className="size-3.5 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col gap-0.5">
                  <p className="text-sm font-medium">My Account</p>
                  <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs text-muted-foreground font-normal px-2 py-1">
                Appearance
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={setTheme}>
                {APPEARANCE_OPTIONS.map(({ value, label, icon: Icon }) => (
                  <DropdownMenuRadioItem key={value} value={value} className="cursor-pointer">
                    <Icon className="size-3.5 mr-2" />
                    {label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="cursor-pointer text-destructive focus:text-destructive"
                onClick={logout}
              >
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        {/* Page area */}
        <main className="flex-1 overflow-auto p-6">
          {activeSection === "dashboard" && (
            <DashboardSection
              onNavigateToFlags={() => router.push("/flagged")}
            />
          )}
          {activeSection === "dna" && <DNASection />}
          {activeSection === "microlearnings" && <MicrolearningsSection />}
          {activeSection === "avatars" && <AvatarsSection />}
          {activeSection === "patterns" && <PatternsSection />}
          {activeSection === "team" && <TeamSection />}
          {activeSection === "organization" && <OrganizationSection />}
          {activeSection === "flagged" && <FlaggedMessagesSection />}
        </main>
      </div>
    </div>
  );
}
