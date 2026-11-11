import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Moon, Sun } from 'lucide-react';

export interface NavItem<T extends string> {
  id: T;
  label: string;
  icon: LucideIcon;
}

interface AppShellProps<T extends string> {
  brandName: string;
  brandIcon: LucideIcon;
  items: NavItem<T>[];
  active: T;
  onSelect: (id: T) => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  headerRight?: ReactNode;
  children: ReactNode;
}

export function AppShell<T extends string>({
  brandName,
  brandIcon: BrandIcon,
  items,
  active,
  onSelect,
  theme,
  onToggleTheme,
  headerRight,
  children,
}: AppShellProps<T>) {
  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-slate-100 md:flex">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white px-4 py-6 dark:border-slate-800 dark:bg-slate-900 md:flex">
        <div className="mb-8 flex items-center gap-3 px-2">
          <div className="rounded-xl bg-teal-600 p-2 text-white">
            <BrandIcon size={20} />
          </div>
          <span className="text-lg font-semibold tracking-tight">{brandName}</span>
        </div>
        <nav className="flex flex-col gap-1">
          {items.map((item) => (
            <NavButton key={item.id} item={item} active={active === item.id} onSelect={onSelect} />
          ))}
        </nav>
        <div className="mt-auto flex items-center justify-between px-2 pt-6">
          <ThemeButton theme={theme} onToggle={onToggleTheme} />
        </div>
      </aside>

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90 md:hidden">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-teal-600 p-1.5 text-white">
              <BrandIcon size={16} />
            </div>
            <span className="font-semibold">{brandName}</span>
          </div>
          <div className="flex items-center gap-2">
            {headerRight}
            <ThemeButton theme={theme} onToggle={onToggleTheme} />
          </div>
        </header>

        <main className="flex-1 px-4 pb-28 pt-6 sm:px-6 md:px-10 md:pb-10 md:pt-10">
          <div className="mx-auto w-full max-w-5xl">{children}</div>
        </main>

        <nav className="fixed inset-x-0 bottom-0 z-20 grid border-t border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 md:hidden"
          style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
          {items.map((item) => {
            const Icon = item.icon;
            const isActive = active === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item.id)}
                className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition ${
                  isActive ? 'text-teal-600 dark:text-teal-400' : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                <Icon size={20} />
                {item.label}
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

function NavButton<T extends string>({
  item,
  active,
  onSelect,
}: {
  item: NavItem<T>;
  active: boolean;
  onSelect: (id: T) => void;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition duration-150 ${
        active
          ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/10 dark:text-teal-300'
          : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
      }`}
    >
      <Icon size={18} />
      {item.label}
    </button>
  );
}

function ThemeButton({ theme, onToggle }: { theme: 'dark' | 'light'; onToggle: () => void }) {
  const Icon = theme === 'dark' ? Sun : Moon;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre'}
      className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-800"
    >
      <Icon size={18} />
    </button>
  );
}
