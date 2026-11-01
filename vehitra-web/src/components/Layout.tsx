import { useEffect, useState, type ReactNode } from 'react';
import {
  Activity,
  Car,
  ChevronRight,
  GitBranch,
  Inbox,
  LayoutDashboard,
  LogOut,
  Menu,
  RefreshCw,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { AdminMember, PageId } from '../types';
import { roleLabel } from '../lib/format';
import { Avatar, Badge, Button, IconButton } from './ui';

type NavItem = { id: PageId; label: string; icon: LucideIcon; description: string };

const NAV_SECTIONS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Workspace',
    items: [
      { id: 'overview', label: 'Overview', icon: LayoutDashboard, description: 'Catalog health and recent activity' },
      { id: 'catalog', label: 'Vehicle catalog', icon: Car, description: 'Models, types, and availability' },
      { id: 'rules', label: 'Maintenance rules', icon: Wrench, description: 'Intervals, evidence, and review' },
      { id: 'releases', label: 'Catalog releases', icon: GitBranch, description: 'Drafts and immutable versions' },
      { id: 'requests', label: 'Model requests', icon: Inbox, description: 'Demand from the mobile app' },
    ],
  },
  {
    label: 'Governance',
    items: [
      { id: 'admins', label: 'Administrators', icon: Users, description: 'Roles and access status' },
      { id: 'audit', label: 'Audit log', icon: ScrollText, description: 'Append-only change history' },
      { id: 'health', label: 'System health', icon: Activity, description: 'Backend and integration checks' },
      { id: 'settings', label: 'Settings', icon: Settings, description: 'Session and workspace preferences' },
    ],
  },
];

export const PAGE_META: Record<PageId, { label: string; description: string }> = Object.fromEntries(
  NAV_SECTIONS.flatMap((section) => section.items.map((item) => [item.id, { label: item.label, description: item.description }])),
) as Record<PageId, { label: string; description: string }>;

export function Layout({
  page,
  onNavigate,
  member,
  isDemo,
  lastLoaded,
  onRefresh,
  refreshing,
  onSignOut,
  children,
}: {
  page: PageId;
  onNavigate: (page: PageId) => void;
  member: AdminMember;
  isDemo: boolean;
  lastLoaded: string;
  onRefresh: () => void;
  refreshing: boolean;
  onSignOut: () => void;
  children: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    setMobileOpen(false);
  }, [page]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  return (
    <div className={`app-shell ${mobileOpen ? 'nav-open' : ''}`}>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <Sidebar
        page={page}
        onNavigate={(next) => {
          onNavigate(next);
          setMobileOpen(false);
        }}
        member={member}
        isDemo={isDemo}
        onSignOut={onSignOut}
      />
      <div className="app-body">
        <header className="topbar">
          <div className="topbar-left">
            <IconButton label={mobileOpen ? 'Close navigation' : 'Open navigation'} className="menu-btn" onClick={() => setMobileOpen((open) => !open)}>
              {mobileOpen ? <X size={19} /> : <Menu size={19} />}
            </IconButton>
            <div className="topbar-crumb">
              <span>Admin console</span>
              <ChevronRight size={14} aria-hidden />
              <strong>{PAGE_META[page].label}</strong>
            </div>
          </div>
          <div className="topbar-right">
            <Badge tone={isDemo ? 'warning' : 'success'} dot>
              {isDemo ? 'Demo data' : 'Live backend'}
            </Badge>
            <span className="topbar-updated" title={new Date(lastLoaded).toLocaleString()}>
              Updated {relative(lastLoaded)}
            </span>
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw size={14} className={refreshing ? 'spin' : undefined} />}
              onClick={onRefresh}
              disabled={refreshing || isDemo}
              title={isDemo ? 'Connect Supabase to refresh live data' : 'Reload workspace data'}
            >
              Refresh
            </Button>
          </div>
        </header>
        {isDemo && (
          <div className="demo-banner" role="status">
            <ShieldCheck size={16} aria-hidden />
            <span>
              <strong>Demo workspace.</strong> All data is local sample data and every write action is disabled. Configure
              Supabase to operate the live catalog.
            </span>
          </div>
        )}
        <main id="main-content" className="app-main">
          {children}
        </main>
      </div>
      {mobileOpen && <button type="button" className="nav-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    </div>
  );
}

function Sidebar({
  page,
  onNavigate,
  member,
  isDemo,
  onSignOut,
}: {
  page: PageId;
  onNavigate: (page: PageId) => void;
  member: AdminMember;
  isDemo: boolean;
  onSignOut: () => void;
}) {
  return (
    <aside className="sidebar" aria-label="Primary navigation">
      <div className="brand">
        <span className="brand-mark" aria-hidden>
          V
        </span>
        <div>
          <span className="brand-name">Vehitra</span>
          <span className="brand-sub">Admin console</span>
        </div>
      </div>

      <nav className="nav">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label} className="nav-section">
            <p className="nav-label">{section.label}</p>
            {section.items.map((item) => {
              const Icon = item.icon;
              const active = item.id === page;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={active ? 'nav-item active' : 'nav-item'}
                  onClick={() => onNavigate(item.id)}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon size={17} aria-hidden />
                  <span>{item.label}</span>
                  {active && <span className="nav-active-dot" aria-hidden />}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="member-card">
          <Avatar name={member.display_name} />
          <div className="member-copy">
            <strong>{member.display_name}</strong>
            <span>{isDemo ? 'Demo session' : roleLabel(member.role)}</span>
          </div>
          <IconButton label="Sign out" onClick={onSignOut} title="Sign out">
            <LogOut size={16} />
          </IconButton>
        </div>
        <p className="sidebar-note">
          {isDemo ? 'No credentials are stored in demo mode.' : 'Access is enforced by database roles and row-level security.'}
        </p>
      </div>
    </aside>
  );
}

function relative(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'just now';
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}
