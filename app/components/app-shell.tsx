import Link from "next/link";
import { redirect } from "next/navigation";
import {
  BookOpenText,
  CloudArrowUp,
  Feather,
  BookBookmark,
  GlobeSimple,
  House,
  MagnifyingGlass,
  PenNib,
  Scissors,
  Shuffle,
  Sparkle,
  Trophy,
  UserCircle,
} from "@phosphor-icons/react/dist/ssr";
import { getCurrentUser } from "@/lib/auth/current-user";
import { LogoutButton } from "@/app/workspace/logout-button";

/** 应用壳：左侧功能导航（分组）。未登录重定向。 */
const groups = [
  {
    label: "创作",
    items: [
      { href: "/workspace", label: "工作台", icon: House },
      { href: "/chat", label: "写作对话", icon: PenNib },
      { href: "/projects", label: "我的作品", icon: BookOpenText },
      { href: "/distill", label: "风格蒸馏", icon: Feather },
      { href: "/deconstruct", label: "小说拆解", icon: Scissors },
      { href: "/draw", label: "抽卡模式", icon: Shuffle },
    ],
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

export async function AppShell({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/api/v1/auth/logout");
  }

  return (
    <div className="flex min-h-[100dvh]">
      {/* 左侧导航 */}
      <aside className="flex w-56 shrink-0 flex-col border-r border-surface-2 bg-zinc-950/60 px-4 py-5">
        <Link href="/workspace" className="mb-6 flex items-center gap-2.5 px-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 text-sm font-bold text-white">
            墨
          </span>
          <span className="text-base font-semibold tracking-wide">墨舟</span>
        </Link>
        <nav className="flex flex-1 flex-col gap-4 overflow-y-auto" aria-label="应用导航">
          {groups.map((group) => (
            <div key={group.label}>
              <p className="px-3 pb-1 text-[10px] font-medium uppercase tracking-[0.18em] text-faint">
                {group.label}
              </p>
              <div className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-zinc-400 transition hover:bg-surface hover:text-zinc-100"
                    >
                      <Icon size={18} weight="duotone" aria-hidden />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="flex items-center justify-between border-t border-surface-2 px-2 pt-4">
          <span className="truncate text-xs text-faint" title={user.email}>
            {user.email}
          </span>
          <LogoutButton />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
