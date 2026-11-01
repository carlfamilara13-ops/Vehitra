import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertCircle, ArrowRight, Eye, EyeOff, Loader2, LockKeyhole, ShieldCheck } from 'lucide-react';
import type { PageId, SessionUser, WorkspaceBundle } from './types';
import { isSupabaseConfigured, supabaseProjectHost } from './supabase';
import {
  AccessError,
  getSession,
  loadWorkspace,
  signIn,
  signOut,
  subscribeToAuth,
} from './lib/api';
import { demoMember, demoWorkspace } from './lib/demo';
import { buildModelViews } from './lib/derive';
import { friendlyError } from './lib/format';
import { Layout } from './components/Layout';
import { Button, ErrorState, Field, Input, ToastViewport, useToasts } from './components/ui';
import { OverviewPage } from './pages/OverviewPage';
import { CatalogPage } from './pages/CatalogPage';
import { RulesPage } from './pages/RulesPage';
import { ReleasesPage } from './pages/ReleasesPage';
import { RequestsPage } from './pages/RequestsPage';
import { AdminsPage } from './pages/AdminsPage';
import { AuditPage } from './pages/AuditPage';
import { HealthPage } from './pages/HealthPage';
import { SettingsPage } from './pages/SettingsPage';

type RunAction = (label: string, action: () => Promise<unknown>) => Promise<boolean>;

export default function App() {
  const [booting, setBooting] = useState(isSupabaseConfigured);
  const [demo, setDemo] = useState(!isSupabaseConfigured);
  const [bundle, setBundle] = useState<WorkspaceBundle | null>(
    !isSupabaseConfigured ? { workspace: demoWorkspace, member: demoMember } : null,
  );
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(
    !isSupabaseConfigured ? { id: demoMember.user_id, email: demoMember.email } : null,
  );
  const [signedOut, setSignedOut] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState<PageId>('overview');
  const [focusModelId, setFocusModelId] = useState<string | null>(null);
  const { toasts, notify, dismiss } = useToasts();

  const loadForUser = useCallback(async (userId: string) => {
    const next = await loadWorkspace(userId);
    setBundle(next);
    setDemo(false);
    setLoadError(null);
    setAuthNotice(null);
    setSignedOut(false);
    setSessionUser({ id: next.member.user_id, email: next.member.email });
    return next;
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setBooting(false);
      return;
    }
    let active = true;
    const bootstrap = async () => {
      try {
        const session = await getSession();
        if (!active) return;
        if (!session) {
          setSignedOut(true);
          return;
        }
        setSessionUser({ id: session.user.id, email: session.user.email ?? '' });
        await loadForUser(session.user.id);
      } catch (error) {
        if (!active) return;
        if (error instanceof AccessError) {
          setAuthNotice(error.message);
          await signOut().catch(() => {});
          setSignedOut(true);
          setSessionUser(null);
        } else {
          setLoadError(friendlyError(error));
          setSignedOut(true);
        }
      } finally {
        if (active) setBooting(false);
      }
    };
    void bootstrap();

    const unsubscribe = subscribeToAuth((session) => {
      if (!session) {
        setBundle(null);
        setSessionUser(null);
        setDemo(false);
        setSignedOut(true);
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [loadForUser]);

  const refresh = useCallback(
    async (silent = false) => {
      if (demo) {
        setBundle((current) =>
          current
            ? {
                ...current,
                workspace: { ...current.workspace, loaded_at: new Date().toISOString() },
              }
            : current,
        );
        if (!silent) notify('info', 'Demo workspace refreshed', 'Sample data is local to this browser.');
        return;
      }
      if (!sessionUser) return;
      setRefreshing(true);
      try {
        await loadForUser(sessionUser.id);
        if (!silent) notify('success', 'Workspace refreshed');
      } catch (error) {
        notify('error', 'Refresh failed', friendlyError(error));
        if (error instanceof AccessError) {
          setAuthNotice(error.message);
          await signOut().catch(() => {});
          setBundle(null);
          setSessionUser(null);
          setSignedOut(true);
        }
      } finally {
        setRefreshing(false);
      }
    },
    [demo, loadForUser, notify, sessionUser],
  );

  const runAction = useCallback<RunAction>(
    async (label, action) => {
      if (demo) {
        notify('info', 'Demo mode is read-only', 'Configure Supabase and sign in as an administrator to make changes.');
        return false;
      }
      try {
        await action();
        notify('success', label);
        await refresh(true);
        return true;
      } catch (error) {
        notify('error', `${label} failed`, friendlyError(error));
        await refresh(true);
        return false;
      }
    },
    [demo, notify, refresh],
  );

  const openRules = useCallback((modelId: string) => {
    setFocusModelId(modelId);
    setPage('rules');
  }, []);

  const navigate = useCallback((next: PageId) => {
    setPage(next);
    if (next !== 'rules') setFocusModelId(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleSignOut = useCallback(async () => {
    await signOut().catch(() => {});
    setBundle(null);
    setSessionUser(null);
    setDemo(false);
    setLoadError(null);
    setAuthNotice(null);
    setSignedOut(true);
    setPage('overview');
    setFocusModelId(null);
  }, []);

  const leaveDemo = useCallback(() => {
    setDemo(false);
    setBundle(null);
    setSessionUser(null);
    setLoadError(null);
    setAuthNotice(null);
    setSignedOut(true);
    setPage('overview');
  }, []);

  const views = useMemo(() => (bundle ? buildModelViews(bundle.workspace) : []), [bundle]);

  if (booting) {
    return (
      <div className="boot-screen" role="status" aria-live="polite">
        <div className="boot-mark" aria-hidden>
          V
        </div>
        <Loader2 className="spin" size={22} aria-hidden />
        <p>Preparing the admin console…</p>
      </div>
    );
  }

  if ((!bundle || signedOut) && !demo) {
    if (sessionUser && loadError) {
      return (
        <div className="boot-shell">
          <div className="fatal-card">
            <ErrorState
              title="The workspace could not load"
              message={loadError}
              onRetry={() => {
                setLoadError(null);
                void refresh();
              }}
            />
            <p className="muted">
              If this mentions a missing table or function, apply <code>supabase/migrations/20261026000100_admin_console.sql</code>{' '}
              to this project.
            </p>
            <Button variant="secondary" onClick={handleSignOut}>
              Sign out
            </Button>
          </div>
        </div>
      );
    }
    return (
      <AuthScreen
        initialMessage={authNotice}
        onSignedIn={(next) => {
          setBundle(next.bundle);
          setDemo(false);
          setLoadError(null);
          setAuthNotice(null);
          setSignedOut(false);
          setSessionUser(next.user);
        }}
        onDemo={isSupabaseConfigured ? undefined : () => {
          setDemo(true);
          setBundle({ workspace: demoWorkspace, member: demoMember });
          setSessionUser({ id: demoMember.user_id, email: demoMember.email });
          setSignedOut(false);
        }}
      />
    );
  }

  if (!bundle) {
    return (
      <div className="boot-screen" role="status" aria-live="polite">
        <Loader2 className="spin" size={22} aria-hidden />
        <p>Loading workspace…</p>
      </div>
    );
  }

  const { workspace, member } = bundle;

  return (
    <>
      <Layout
        page={page}
        onNavigate={navigate}
        member={member}
        isDemo={demo}
        lastLoaded={workspace.loaded_at}
        onRefresh={() => void refresh()}
        refreshing={refreshing}
        onSignOut={demo ? leaveDemo : handleSignOut}
      >
        {page === 'overview' && <OverviewPage workspace={workspace} views={views} member={member} onNavigate={navigate} />}
        {page === 'catalog' && (
          <CatalogPage workspace={workspace} views={views} member={member} runAction={runAction} openRules={openRules} />
        )}
        {page === 'rules' && (
          <RulesPage
            workspace={workspace}
            views={views}
            member={member}
            runAction={runAction}
            focusModelId={focusModelId}
            onFocusModel={setFocusModelId}
          />
        )}
        {page === 'releases' && (
          <ReleasesPage workspace={workspace} views={views} member={member} runAction={runAction} openRules={openRules} />
        )}
        {page === 'requests' && (
          <RequestsPage workspace={workspace} member={member} runAction={runAction} openCatalog={() => navigate('catalog')} />
        )}
        {page === 'admins' && <AdminsPage workspace={workspace} member={member} runAction={runAction} />}
        {page === 'audit' && <AuditPage workspace={workspace} />}
        {page === 'health' && (
          <HealthPage workspace={workspace} member={member} reload={() => void refresh()} loading={refreshing} />
        )}
        {page === 'settings' && (
          <SettingsPage
            workspace={workspace}
            member={member}
            demo={demo}
            reload={() => void refresh()}
            loading={refreshing}
            signOut={() => void handleSignOut()}
            leaveDemo={leaveDemo}
          />
        )}
      </Layout>
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </>
  );
}

function AuthScreen({
  onSignedIn,
  onDemo,
  initialMessage,
}: {
  onSignedIn: (result: { bundle: WorkspaceBundle; user: SessionUser }) => void;
  onDemo?: () => void;
  initialMessage?: string | null;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState<string | null>(initialMessage ?? null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);
    if (!isSupabaseConfigured) {
      setMessage('Supabase is not configured. Add the public environment variables and restart the dev server.');
      return;
    }
    if (!email.trim() || !password) {
      setMessage('Enter your administrator email and password.');
      return;
    }
    setBusy(true);
    try {
      await signIn(email, password);
      const session = await getSession();
      if (!session) throw new Error('The sign-in succeeded but no session was returned. Try again.');
      const bundle = await loadWorkspace(session.user.id);
      onSignedIn({ bundle, user: { id: bundle.member.user_id, email: bundle.member.email } });
    } catch (error) {
      if (error instanceof AccessError) {
        await signOut().catch(() => {});
        setMessage(error.message);
      } else {
        setMessage(friendlyError(error));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-shell">
      <aside className="auth-aside">
        <div className="auth-brand">
          <span className="auth-mark" aria-hidden>
            V
          </span>
          <div>
            <strong>Vehitra</strong>
            <span>Admin console</span>
          </div>
        </div>
        <div className="auth-aside-copy">
          <span className="eyebrow">CATALOG OPERATIONS</span>
          <h1>Maintenance data people can trust.</h1>
          <p>
            Review evidence, publish immutable catalog versions, and keep the mobile app honest about what is verified and what is
            still missing.
          </p>
          <ul className="auth-points">
            <li>
              <ShieldCheck size={16} aria-hidden />
              Database-enforced roles and row-level security
            </li>
            <li>
              <LockKeyhole size={16} aria-hidden />
              No service-role key in the browser
            </li>
            <li>
              <AlertCircle size={16} aria-hidden />
              Unreviewed intervals stay clearly labelled
            </li>
          </ul>
        </div>
        <p className="auth-aside-foot">Published versions are immutable. Existing vehicles keep their accepted snapshot.</p>
      </aside>

      <main className="auth-main">
        <div className="auth-panel">
          <div className="auth-panel-head">
            <span className="eyebrow">ADMINISTRATOR SIGN IN</span>
            <h2>Welcome back.</h2>
            <p className="muted">
              {isSupabaseConfigured
                ? `Connected to ${supabaseProjectHost}.`
                : 'This console is not connected to a Supabase project yet.'}
            </p>
          </div>

          {!isSupabaseConfigured && (
            <div className="auth-config" role="status">
              <strong>Environment required</strong>
              <p>
                Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> in{' '}
                <code>vehitra-web/.env.local</code>, then restart Vite. Use the public publishable key only.
              </p>
            </div>
          )}

          <form className="auth-form" onSubmit={submit}>
            <Field label="Email address" htmlFor="auth-email">
              <Input
                id="auth-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="admin@vehitra.app"
                disabled={busy}
              />
            </Field>
            <Field label="Password" htmlFor="auth-password">
              <div className="password-field">
                <Input
                  id="auth-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter your password"
                  disabled={busy}
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword((shown) => !shown)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </Field>
            {message && (
              <p className="auth-error" role="alert">
                <AlertCircle size={15} aria-hidden />
                {message}
              </p>
            )}
            <Button type="submit" variant="primary" loading={busy} className="auth-submit">
              {busy ? 'Signing in…' : 'Sign in securely'}
            </Button>
          </form>

          {onDemo && (
            <div className="auth-demo">
              <span>No backend configured?</span>
              <Button variant="secondary" onClick={onDemo}>
                Open demo workspace
              </Button>
            </div>
          )}

          <div className="auth-foot">
            <LockKeyhole size={14} aria-hidden />
            <span>
              Access requires an active row in <code>admin_members</code>. The first super admin is bootstrapped with SQL; see the
              README.
            </span>
          </div>
        </div>
      </main>
    </div>
  );
}
