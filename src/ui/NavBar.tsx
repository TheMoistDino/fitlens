import { NavLink } from 'react-router-dom';

const TABS = [
  { to: '/scan', label: 'Food Scanner', icon: '🥗' },
  { to: '/gym', label: 'Gym Coach', icon: '🏋️' },
  { to: '/workout', label: 'Bodyweight', icon: '🤸' },
  { to: '/dashboard', label: 'Dashboard', icon: '📊' },
] as const;

/** Bottom tab bar on mobile, top bar on desktop. */
export function NavBar() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-800 bg-neutral-950/90 pb-[env(safe-area-inset-bottom)] backdrop-blur md:static md:border-b md:border-t-0">
      <div className="mx-auto flex max-w-5xl items-center justify-around md:justify-start md:gap-2 md:px-4">
        <span className="hidden py-3 pr-6 text-lg font-black tracking-tight text-emerald-400 md:block">FitLens</span>
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium md:flex-none md:flex-row md:gap-2 md:rounded-lg md:px-3 md:text-sm ${
                isActive ? 'text-emerald-400' : 'text-neutral-400 hover:text-neutral-200'
              }`
            }
          >
            <span aria-hidden className="text-lg md:text-base">{t.icon}</span>
            {t.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
