"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookBookmark,
  BookOpenText,
  CloudArrowUp,
  Feather,
  GlobeSimple,
  House,
  ListChecks,
  MagnifyingGlass,
  PenNib,
  Scissors,
  Sparkle,
  Trophy,
  UserCircle,
} from "@phosphor-icons/react";
import { LogoutButton } from "@/app/workspace/logout-button";
import { BrandLockup } from "@/components/brand-lockup";

type NavItem = {
  href: string;
  label: string;
  icon: typeof House;
};

const groups: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "创作",
    items: [
      { href: "/workspace", label: "工作台", icon: House },
      { href: "/chat", label: "写作对话", icon: PenNib },
      { href: "/projects", label: "我的作品", icon: BookOpenText },
      { href: "/distill", label: "风格蒸馏", icon: Feather },
      { href: "/deconstruct", label: "小说拆解", icon: Scissors },
    ],
  },
  {
    label: "工作流",
    items: [{ href: "/tasks", label: "任务中心", icon: ListChecks }],
  },
  {
    label: "资源",
    items: [
      { href: "/search", label: "书源搜索", icon: MagnifyingGlass },
      { href: "/shelf", label: "书源书架", icon: BookBookmark },
      { href: "/skills", label: "技能广场", icon: Sparkle },
      { href: "/rankings", label: "网文扫榜", icon: Trophy },
      { href: "/websearch", label: "联网搜索", icon: GlobeSimple },
      { href: "/sync", label: "云同步", icon: CloudArrowUp },
    ],
  },
  {
    label: "账户",
    items: [{ href: "/account", label: "会员中心", icon: UserCircle }],
  },
];

const mobileItems = [
  { href: "/workspace", label: "工作台", icon: House },
  { href: "/chat", label: "对话", icon: PenNib },
  { href: "/projects", label: "作品", icon: BookOpenText },
  { href: "/tasks", label: "任务", icon: ListChecks },
  { href: "/account", label: "账户", icon: UserCircle },
];

function isCurrentPath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShellNav({ userEmail }: { userEmail: string }) {
  const pathname = usePathname();

  return (
    <>
      <aside className="mz-sidebar">
        <BrandLockup
          href="/workspace"
          ariaLabel="返回墨舟工作台"
          showStudio
          className="mb-7 px-2"
        />

        <nav className="mz-sidebar-nav" aria-label="应用导航">
          {groups.map((group) => (
            <div key={group.label} className="mz-nav-group">
              <p className="mz-nav-label">{group.label}</p>
              <div className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = isCurrentPath(pathname, item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      data-active={active}
                      aria-current={active ? "page" : undefined}
                      className="mz-nav-link"
                    >
                      <Icon size={17} weight={active ? "fill" : "duotone"} aria-hidden />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="mz-sidebar-footer">
          <span className="min-w-0 truncate text-[11px] text-faint" title={userEmail}>
            {userEmail}
          </span>
          <LogoutButton />
        </div>
      </aside>

      <nav className="mz-mobile-bar" aria-label="移动端主导航">
        {mobileItems.map((item) => {
          const Icon = item.icon;
          const active = isCurrentPath(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              data-active={active}
              aria-current={active ? "page" : undefined}
              className="mz-mobile-link"
            >
              <Icon size={18} weight={active ? "fill" : "duotone"} aria-hidden />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
