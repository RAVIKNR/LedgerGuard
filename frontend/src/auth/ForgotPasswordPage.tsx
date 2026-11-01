import { useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { Button, Input } from '../components/ui'
import { api, getApiErrorMessage } from '../lib/api'
import { ShieldCheck, TriangleAlert } from 'lucide-react'

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState('')
  const [sending, setSending] = useState(false)
  const [state, setState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const navigate = useNavigate()
  const reducedMotion = useReducedMotion()

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setEmailError('')
    setMessage('')

    if (!email || !email.trim()) {
      setEmailError('Enter your email address')
      return
    }

    setState('loading')
    setSending(true)

    try {
      const response = await api.post<{ accountFound: boolean; message: string }>('/auth/forgot-password', {
        email: email.trim().toLowerCase()
      })
      setState('success')
      setMessage(response.data.accountFound
        ? 'Password reset link sent to your registered email.'
        : 'No account found with this email address.')
    } catch (error) {
      setState('error')
      setMessage(getApiErrorMessage(error, 'We could not process the password reset request.'))
    } finally {
      setSending(false)
    }
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
          <span className="auth-kicker">Forgot password</span>
          <h1>Reset your password</h1>
          <p>Enter your email address below and we'll send you a password reset link.</p>
        </motion.div>

        {state !== 'idle' && (
          <div className={`auth-verification ${state}`} role="status">
            {state === 'success' && <ShieldCheck size={16} />}
            {state === 'error' && <TriangleAlert size={16} />}
            {message}
          </div>
        )}

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          {emailError && <div className="form-error" role="alert">{emailError}</div>}
          <Input
            label="Account email"
            type="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value)
              setEmailError('')
            }}
            placeholder="you@example.com"
            autoComplete="email"
          />
          <Button type="submit" className="auth-submit" disabled={sending}>
            {sending ? <><span className="spinner" /> Sending…</> : 'Send reset link'}
          </Button>
          <div className="auth-options">
            <button type="button" className="auth-link" onClick={() => navigate('/signin')}>
              Sign in instead
            </button>
          </div>
        </form>
      </div>
    </section>
  </main>
}
