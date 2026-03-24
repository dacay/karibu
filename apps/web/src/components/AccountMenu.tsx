"use client";

import { Sun, Moon, Monitor, ChevronDown } from "lucide-react";
import { useTheme } from "next-themes";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
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
import { api } from "@/lib/api";

const APPEARANCE_OPTIONS: { value: string; label: string; icon: React.ElementType }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

function getInitials(email: string): string {
  const [local] = email.split("@");
  const parts = local.split(/[._-]/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return local.slice(0, 2).toUpperCase();
}

export function AccountMenu() {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const queryClient = useQueryClient();

  const { data: profileData } = useQuery({
    queryKey: ["user", "me"],
    queryFn: api.user.me,
    enabled: !!user,
  });

  const { data: avatarsData } = useQuery({
    queryKey: ["avatars"],
    queryFn: api.avatars.list,
    enabled: !!user,
  });

  const updatePreferenceMutation = useMutation({
    mutationFn: (preferredAvatarId: string | null) =>
      api.user.updatePreferences({ preferredAvatarId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user", "me"] });
    },
  });

  const initials = user?.email ? getInitials(user.email) : "?";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="flex items-center gap-2 h-9 px-2">
          <Avatar className="size-7">
            <AvatarFallback className="text-xs">{initials}</AvatarFallback>
          </Avatar>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-medium">My Account</p>
            <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {avatarsData?.avatars && avatarsData.avatars.length > 0 && (
          <>
            <DropdownMenuLabel className="text-xs text-muted-foreground font-normal px-2 py-1">
              Chat Avatar
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={profileData?.user.preferredAvatarId ?? "default"}
              onValueChange={(val) =>
                updatePreferenceMutation.mutate(val === "default" ? null : val)
              }
            >
              <DropdownMenuRadioItem value="default" className="cursor-pointer">
                Use default
              </DropdownMenuRadioItem>
              {avatarsData.avatars.map((a) => (
                <DropdownMenuRadioItem key={a.id} value={a.id} className="cursor-pointer">
                  {a.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
          </>
        )}

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
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
