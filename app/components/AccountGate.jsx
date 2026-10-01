"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Columns3, LogOut, Moon, Sun } from 'lucide-react';
import { session, scrubLegacyAccessKey, performAuth } from '../client/session.mjs';

export default function AccountGate({ children }) {
  const [account, setAccount] = useState(null);
  const [ready, setReady] = useState(false);
  const [theme, setTheme] = useState('light');
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const authBusy = useRef(false);
  const refresh = useCallback(async () => {
    try { const value = await session.read(); setAccount(value); setReady(true); }
    catch (e) { if (e.name !== 'AbortError') { session.accept({ enabled: true, user: null }, true); setAccount(null); setPassword(''); setError(e.message); setReady(true); } }
  }, []);
  useEffect(() => {
    try { scrubLegacyAccessKey(localStorage); } catch {}
    let saved; try { saved = localStorage.getItem('portfolio-theme'); } catch {}
    setTheme(saved === 'dark' || (!saved && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light');
    refresh();
    const expired = () => { setAccount(null); setPassword(''); setError('Your session expired. Sign in again.'); refresh(); };
    const focus = () => { if (!authBusy.current && document.visibilityState === 'visible') refresh(); };
    window.addEventListener('arena-session-expired', expired);
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', focus);
    return () => { window.removeEventListener('arena-session-expired', expired); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); };
  }, [refresh]);
  useEffect(() => { document.documentElement.style.colorScheme = theme; }, [theme]);
  const toggleTheme = () => { const next = theme === 'light' ? 'dark' : 'light'; setTheme(next); try { localStorage.setItem('portfolio-theme', next); } catch {} };
  const nextAuth = (action, fields = {}) => performAuth(action, fields, window.location.origin);
  async function submit(event) {
    event.preventDefault(); authBusy.current = true; setBusy(true); setError('');
    try {
      if (mode === 'signup') {
        if (password.length < 12 || new TextEncoder().encode(password).length > 72) throw new Error('Use at least 12 characters and no more than 72 UTF-8 bytes.');
        await session.request('/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
      }
      await nextAuth('callback/credentials', { email, password });
      setPassword(''); await refresh();
    } catch (e) { if (e.name !== 'AbortError') setError(e.message); }
    finally { authBusy.current = false; setBusy(false); }
  }
  async function signout() {
    authBusy.current = true; setBusy(true); setError('');
    session.accept({ enabled: true, user: null }, true); setAccount({ enabled: true, user: null }); setPassword('');
    try { await nextAuth('signout'); await refresh(); }
    catch { setError('Sign-out could not be confirmed. Retry or refresh before leaving a shared device.'); }
    finally { authBusy.current = false; setBusy(false); }
  }
  const signedIn = account?.user || account?.enabled === false;
  return <div className="lovable-ui arena-root" data-theme={theme}>
    <header className="portfolio-header">
      <a className="brand" href="/" aria-label="Model Arena home"><Columns3 aria-hidden="true" /><span>Model Arena</span></a>
      <div className="header-actions">
        <button className="btn icon" onClick={toggleTheme} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}>{theme === 'light' ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}</button>
        {account?.user && <><span className="account-email" title={account.user.email}>{account.user.email}</span><button className="btn" onClick={signout} disabled={busy}><LogOut aria-hidden="true" /><span>Sign out</span></button></>}
        {account?.enabled === false && <span className="badge">Local fixture</span>}
      </div>
    </header>
    {!ready ? <main className="auth-loading" role="status">Opening your workspace…</main> : signedIn ? children(account) : <main className="auth-layout">
      <section className="auth-intro"><span className="eyebrow">A fair comparison, in one place</span><h1>Find the right small model for your task.</h1><p>Compare responses side by side, use the same reference, and inspect a separate grader’s scores.</p><div className="auth-note"><Columns3 aria-hidden="true" /><span>Start with a prepared example. No provider calls needed.</span></div></section>
      <section className="card auth-card"><h2>{mode === 'signup' ? 'Create your account' : 'Sign in'}</h2><p className="hint">Your workspace is saved in this browser under your account.</p>
        <form onSubmit={submit}>
          <label htmlFor="auth-email">Email</label><input id="auth-email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required maxLength={254} disabled={busy} />
          <label htmlFor="auth-password">Password</label><input id="auth-password" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} required minLength={mode === 'signup' ? 12 : undefined} disabled={busy} />
          {mode === 'signup' && <p className="hint">At least 12 characters. Password recovery by email is not configured.</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="btn primary auth-submit" disabled={busy || !account} aria-busy={busy}>{busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}<ArrowRight aria-hidden="true" /></button>
        </form>
        {!account && <button className="btn" onClick={refresh}>Retry connection</button>}
        <button className="btn text-button" disabled={busy} onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(''); setPassword(''); }}>{mode === 'signin' ? 'New here? Create an account' : 'Already have an account? Sign in'}</button>
      </section>
    </main>}
  </div>;
}
