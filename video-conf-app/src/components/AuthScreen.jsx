import React, { useState } from 'react';
import {
  signInWithPopup, GoogleAuthProvider,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
} from 'firebase/auth';
import { auth } from '../firebase';

export default function AuthScreen() {
  const [mode, setMode]               = useState('login');
  const [email, setEmail]             = useState('');
  const [password, setPassword]       = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError]             = useState('');
  const [loading, setLoading]         = useState(false);

  const handleGoogle = async () => {
    setError(''); setLoading(true);
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (e) {
      setError(e.message.replace('Firebase: ', ''));
    } finally { setLoading(false); }
  };

  const handleEmail = async () => {
    setError('');
    if (!email || !password) return setError('Please fill all fields.');
    if (mode === 'register' && !displayName) return setError('Please enter your name.');
    setLoading(true);
    try {
      if (mode === 'register') {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(cred.user, { displayName });
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (e) {
      setError(e.message.replace('Firebase: ', ''));
    } finally { setLoading(false); }
  };

  return (
    <div className="join-screen">
      <div className="join-card">
        <div className="join-logo">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none"
            stroke="#1D9E75" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 7l-7 5 7 5V7z" />
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
          </svg>
        </div>

        <h1>{mode === 'login' ? 'Welcome back' : 'Create account'}</h1>
        <p className="join-note">Best experienced in Google Chrome</p>

        <div className="join-form">
          {mode === 'register' && (
            <div className="input-group">
              <label className="input-label">Display Name</label>
              <input className="join-input" placeholder="e.g. Alex"
                value={displayName}
                onChange={e => { setDisplayName(e.target.value); setError(''); }} />
            </div>
          )}
          <div className="input-group">
            <label className="input-label">Email</label>
            <input className="join-input" type="email" placeholder="you@example.com"
              value={email}
              onChange={e => { setEmail(e.target.value); setError(''); }}
              onKeyDown={e => e.key === 'Enter' && handleEmail()} />
          </div>
          <div className="input-group">
            <label className="input-label">Password</label>
            <input className="join-input" type="password" placeholder="••••••••"
              value={password}
              onChange={e => { setPassword(e.target.value); setError(''); }}
              onKeyDown={e => e.key === 'Enter' && handleEmail()} />
          </div>

          {error && <p className="join-error">{error}</p>}

          <button className="join-btn" onClick={handleEmail} disabled={loading}>
            {loading
              ? <><span className="btn-spinner" /> Working…</>
              : mode === 'login' ? 'Sign In' : 'Create Account'}
          </button>

          <div style={{ display:'flex', alignItems:'center', gap:8, color:'#333', fontSize:12 }}>
            <div style={{ flex:1, height:1, background:'#1e1e2e' }} />
            or
            <div style={{ flex:1, height:1, background:'#1e1e2e' }} />
          </div>

          <button className="download-btn" onClick={handleGoogle} disabled={loading}>
            <svg width="15" height="15" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continue with Google
          </button>

          <p style={{ color:'#555', fontSize:12, textAlign:'center' }}>
            {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
            <span
              onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}
              style={{ color:'#1D9E75', cursor:'pointer' }}>
              {mode === 'login' ? 'Sign up' : 'Sign in'}
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}