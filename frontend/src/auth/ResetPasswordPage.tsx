import { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '../components/ui'
import { api, getApiErrorMessage } from '../lib/api'
import { Eye, EyeOff, LockKeyhole, ShieldCheck, TriangleAlert } from 'lucide-react'

type State = 'verifying' | 'idle' | 'loading' | 'success' | 'error'

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams()
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [pwError, setPwError] = useState('')
  const [confirmError, setConfirmError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [state, setState] = useState<State>('verifying')
  const [message, setMessage] = useState('')
  const navigate = useNavigate()
  const reducedMotion = useReducedMotion()

  const token = searchParams.get('token')
  const pwValid = newPassword.length >= 6
  const confirmMatch = confirmPassword === newPassword

  useEffect(() => {
    let active = true
    if (!token) {
      setState('error')
      setMessage('This reset link is missing its security token. Request a new link.')
      return () => { active = false }
    }
    void api.get('/auth/reset-password/verify', { params: { token } })
      .then(() => {
        if (active) setState('idle')
      })
      .catch((error) => {
        if (!active) return
        setState('error')
        setMessage(getApiErrorMessage(error, 'This reset link is invalid or expired. Request a new link.'))
      })
    return () => { active = false }
  }, [token])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setPwError('')
    setConfirmError('')
    setMessage('')

    if (!token || state !== 'idle') {
      setState('error')
      setMessage(token ? 'This reset link is invalid or expired. Request a new link.' : 'This reset link is missing its security token. Request a new link.')
      return
    }

    if (!newPassword) { setPwError('Enter a new password'); return }
    if (newPassword.length < 6) { setPwError('Password must be at least 6 characters'); return }
    if (!confirmPassword) { setConfirmError('Confirm your new password'); return }
    if (confirmPassword !== newPassword) { setConfirmError('Passwords do not match'); return }

    setState('loading')
    setSubmitting(true)
    try {
      await api.post<{ message: string }>('/auth/reset-password', {
        token,
        newPassword,
        confirmPassword
      })
      setState('success')
      setMessage('Your password has been reset successfully. You can now sign in with your new password.')
      window.history.replaceState({}, '', window.location.pathname)
    } catch (error) {
      setState('error')
      setMessage(getApiErrorMessage(error, 'We could not reset your password. The link may be invalid or expired.'))
    } finally {
      setSubmitting(false)
    }
  }

  function PasswordToggle(isShown: boolean, onToggle: () => void, label: string) {
    return <button type="button" className="password-toggle" onClick={onToggle} aria-label={label}>
      {isShown ? <EyeOff size={16} /> : <Eye size={16} />}
    </button>
  }

  return <main className="auth-page">
    <div className="auth-visual">
      <div className="auth-orbit orbit-one" />
      <div className="auth-orbit orbit-two" />
      <div className="auth-visual-content">
        <div className="brand auth-brand">
          <div className="brand-mark"><ShieldCheck size={18} /></div>
          <span>ledger<span>guard</span></span>
        </div>
        <div className="auth-quote">
          <p>“Financial clarity should feel effortless.”</p>
          <span>Secure control for every movement of money.</span>
        </div>
        <div className="auth-trust"><ShieldCheck size={14} /> Built for accountable finance</div>
      </div>
    </div>

    <section className="auth-panel">
      <div className="auth-panel-inner">
        <div className="auth-mobile-brand">
          <div className="brand-mark"><ShieldCheck size={18} /></div>
          <span>ledger<span>guard</span></span>
        </div>

        <motion.div
          className="auth-heading"
          initial={reducedMotion ? false : { opacity: 0, y: 8 }}
          animate={reducedMotion ? undefined : { opacity: 1, y: 0 }}
        >
          <span className="auth-kicker">Reset password</span>
          <h1>Set a new password</h1>
          <p>Create a new password for your LedgerGuard account.</p>
        </motion.div>

        {state !== 'idle' && (
          <div className={`auth-verification ${state}`} role="status">
            {state === 'success' && <ShieldCheck size={16} />}
            {state === 'error' && <TriangleAlert size={16} />}
            {message}
          </div>
        )}

        {state === 'verifying' && <div className="auth-verification loading" role="status"><span className="spinner" /> Verifying reset link…</div>}
        {state === 'idle' && <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <label className="auth-field">
            <span className="auth-label">New password</span>
            <span className={`auth-input-wrap ${pwError ? 'has-error' : ''}`}>
              <LockKeyhole size={16} className="auth-input-icon" />
              <input
                type={showNewPassword ? 'text' : 'password'}
                className="ui-input"
                value={newPassword}
                placeholder="At least 6 characters"
                autoComplete="new-password"
                onChange={(event) => { setNewPassword(event.target.value); setPwError('') }}
              />
              {PasswordToggle(showNewPassword, () => setShowNewPassword(!showNewPassword), showNewPassword ? 'Hide password' : 'Show password')}
            </span>
            {pwError && <span className="auth-field-error" id="pw-error" role="alert">{pwError}</span>}
          </label>

          <label className="auth-field">
            <span className="auth-label">Confirm password</span>
            <span className={`auth-input-wrap ${confirmError ? 'has-error' : ''}`}>
              <LockKeyhole size={16} className="auth-input-icon" />
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                className="ui-input"
                value={confirmPassword}
                placeholder="Repeat your new password"
                autoComplete="new-password"
                onChange={(event) => { setConfirmPassword(event.target.value); setConfirmError('') }}
              />
              {PasswordToggle(showConfirmPassword, () => setShowConfirmPassword(!showConfirmPassword), showConfirmPassword ? 'Hide password' : 'Show password')}
            </span>
            {confirmError && <span className="auth-field-error" id="confirm-error" role="alert">{confirmError}</span>}
          </label>

          <Button type="submit" className="auth-submit" disabled={submitting || !pwValid || !confirmMatch}>
            {submitting ? <><span className="spinner" /> Resetting…</> : 'Reset password'}
          </Button>
          <div className="auth-options">
            <span className="auth-link" onClick={() => navigate('/signin')}>Return to sign in</span>
          </div>
        </form>}
        {state === 'success' && <div className="auth-options"><button type="button" className="auth-link" onClick={() => navigate('/signin')}>Return to sign in</button></div>}
      </div>
    </section>
  </main>
}
