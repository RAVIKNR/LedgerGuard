import { useState } from 'react'
import { useForm, type UseFormReturn } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { Eye, EyeOff, LockKeyhole, Mail, ShieldCheck, UserRound } from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'
import { GoogleLogin } from '@react-oauth/google'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui'
import { LedgerObject } from '../components/LedgerObject'
import { getApiErrorMessage, useAuth } from './AuthContext'

const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
})
const registrationSchema = loginSchema.extend({
  name: z.string().trim().min(1, 'Enter your name').max(120, 'Name is too long'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
})
type LoginValues = z.infer<typeof loginSchema>
type RegistrationValues = z.infer<typeof registrationSchema>
type AuthFormValues = LoginValues & Partial<Omit<RegistrationValues, keyof LoginValues>>

export function AuthPage() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [showPassword, setShowPassword] = useState(false)
  const [serverError, setServerError] = useState('')
  const [verificationMessage, setVerificationMessage] = useState('')
  const [verificationEmail, setVerificationEmail] = useState('')
  const [verificationState, setVerificationState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const { login, register, resendVerification, googleLogin, loading } = useAuth()
  const reducedMotion = useReducedMotion()
  const isRegister = mode === 'register'
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
  const form = useForm<AuthFormValues>({
    resolver: zodResolver(isRegister ? registrationSchema : loginSchema),
    mode: 'onBlur',
  })

  async function submit(values: AuthFormValues) {
    setServerError('')
    try {
      if (isRegister) await register({
        name: values.name || '',
        email: values.email,
        password: values.password
      })
      else {
        await login({ email: values.email, password: values.password })
        navigate('/', { replace: true })
      }
      if (isRegister) {
        setVerificationEmail(values.email)
        setVerificationState('success')
        setVerificationMessage('Account created. Check your inbox for a verification link before signing in.')
      }
    } catch (error) {
      if (!isRegister && values.email) setVerificationEmail(values.email)
      const message = getApiErrorMessage(error, isRegister ? 'We could not create your account.' : 'We could not sign you in.')
      setServerError(message)
      if (!isRegister && message.toLowerCase().includes('verify')) {
        setVerificationState('error')
        setVerificationMessage('Your email must be verified before sign-in.')
      }
    }
  }

  function switchMode(nextMode: 'login' | 'register') {
    setMode(nextMode)
    setServerError('')
    setVerificationMessage('')
    setVerificationEmail('')
    setVerificationState('idle')
    form.reset()
  }

  return <main className={`auth-page${isRegister ? ' auth-page-register' : ''}`}>
    <div className="auth-visual"><div className="auth-orbit orbit-one" /><div className="auth-orbit orbit-two" /><LedgerObject variant={isRegister ? 'register' : 'login'} className="auth-installation" /><div className="auth-visual-content"><div className="brand auth-brand"><div className="brand-mark"><ShieldCheck size={18} /></div><span>ledger<span>guard</span></span></div><div className="auth-quote"><p>{isRegister ? 'A more accountable way to manage finance.' : '“Financial clarity should feel effortless.”'}</p><span>{isRegister ? 'Create a secure workspace for your financial operations.' : 'Secure control for every movement of money.'}</span></div><div className="auth-trust"><ShieldCheck size={14} /> Built for accountable finance</div></div></div>
    <section className="auth-panel">
      <div className="auth-panel-inner">
        <div className="auth-mobile-brand"><div className="brand-mark"><ShieldCheck size={18} /></div><span>ledger<span>guard</span></span></div>
        <motion.div className="auth-heading" initial={reducedMotion ? false : { opacity: 0, y: 8 }} animate={reducedMotion ? undefined : { opacity: 1, y: 0 }}>
          <span className="auth-kicker">{isRegister ? 'Get started' : 'Welcome back'}</span>
          <h1>{isRegister ? 'Create your account' : 'Sign in to your workspace'}</h1>
          <p>{isRegister ? 'Set up your secure LedgerGuard workspace in a minute.' : 'Your financial control center is ready when you are.'}</p>
        </motion.div>
        <div className="auth-tabs" role="tablist" aria-label="Authentication method"><button className={!isRegister ? 'active' : ''} onClick={() => switchMode('login')} onKeyDown={(event) => { if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); switchMode('register'); document.getElementById('register-tab')?.focus() } }} role="tab" id="login-tab" aria-controls="auth-form" aria-selected={!isRegister} tabIndex={isRegister ? -1 : 0}>Sign in</button><button className={isRegister ? 'active' : ''} onClick={() => switchMode('register')} onKeyDown={(event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); switchMode('login'); document.getElementById('login-tab')?.focus() } }} role="tab" id="register-tab" aria-controls="auth-form" aria-selected={isRegister} tabIndex={isRegister ? 0 : -1}>Create account</button></div>
        {serverError && <div className="auth-error" role="alert">{serverError}</div>}
        {verificationMessage && <div className={`auth-verification ${verificationState}`} role="status">{verificationMessage}{verificationEmail && (!isRegister || verificationState === 'success') && <button type="button" className="auth-link" onClick={async () => { try { const message = await resendVerification(verificationEmail); setVerificationMessage(message) } catch (error) { setVerificationMessage(getApiErrorMessage(error, 'We could not resend the verification email.')) } }}>Resend verification email</button>}</div>}
        <div className="google-login-section">
          <div className="google-login-heading"><span>Quick access</span><span className="google-login-note">Secure sign-in</span></div>
          <div className="google-button-wrap">
            {googleClientId ? <GoogleLogin onSuccess={async (response) => { if (response.credential) { setServerError(''); try { await googleLogin(response.credential); navigate('/', { replace: true }) } catch (error) { setServerError(getApiErrorMessage(error, 'We could not sign you in with Google.')) } } }} onError={() => setServerError('Google sign-in was cancelled or could not be completed.')} useOneTap={false} theme="outline" size="large" text="continue_with" shape="rectangular" logo_alignment="left" width="350" />
              : <button type="button" className="google-config-button" onClick={() => setServerError('Google sign-in is not configured. Add VITE_GOOGLE_CLIENT_ID to frontend/.env.local and restart Vite.')}><GoogleMark /> Continue with Google</button>}
          </div>
        </div>
        <div className="auth-divider"><span>or continue with email</span></div>
        <form className={`auth-form ${isRegister ? 'auth-register-form' : ''}`} id="auth-form" onSubmit={form.handleSubmit(submit)} noValidate>
          {isRegister && <AuthField label="Full name" name="name" placeholder="Ravi Kumar" type="text" autoComplete="name" icon={<UserRound size={16} />} form={form} />}
          <AuthField label="Email address" name="email" placeholder="you@example.com" type="email" autoComplete="email" icon={<Mail size={16} />} form={form} />
          <AuthField label="Password" name="password" placeholder={isRegister ? 'At least 6 characters' : 'Enter your password'} type={showPassword ? 'text' : 'password'} autoComplete={isRegister ? 'new-password' : 'current-password'} icon={<LockKeyhole size={16} />} form={form} suffix={<button type="button" className="password-toggle" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button>} />
          {!isRegister && <div className="auth-options"><label><input type="checkbox" /> <span>Remember this device</span></label><button type="button" className="auth-link" onClick={() => navigate('/forgot-password')}>Forgot password?</button></div>}
          <Button type="submit" className="auth-submit" disabled={loading}>{loading ? <><span className="spinner" /> {isRegister ? 'Creating account…' : 'Signing in…'}</> : isRegister ? 'Create secure account' : 'Sign in securely'}</Button>
        </form>
        <p className="auth-legal">By continuing, you agree to LedgerGuard’s <button type="button" className="auth-link" onClick={() => setServerError('Terms are provided by your LedgerGuard administrator.')}>Terms</button> and <button type="button" className="auth-link" onClick={() => setServerError('Privacy details are provided by your LedgerGuard administrator.')}>Privacy Policy</button>.</p>
      </div>
    </section>
  </main>
}

function GoogleMark() {
  return <svg aria-hidden="true" className="google-mark" viewBox="0 0 24 24"><path fill="#4285F4" d="M21.35 12.23c0-.72-.06-1.43-.2-2.1H12v3.98h5.24a4.48 4.48 0 0 1-1.94 2.94v2.45h3.14c1.84-1.7 2.91-4.21 2.91-7.27Z" /><path fill="#34A853" d="M12 21.6c2.63 0 4.84-.87 6.45-2.36l-3.14-2.45c-.87.58-1.98.93-3.31.93-2.54 0-4.7-1.72-5.47-4.03H3.28v2.53A9.74 9.74 0 0 0 12 21.6Z" /><path fill="#FBBC05" d="M6.53 13.69a5.85 5.85 0 0 1 0-3.38V7.78H3.28a9.62 9.62 0 0 0 0 8.44l3.25-2.53Z" /><path fill="#EA4335" d="M12 6.28c1.43 0 2.72.49 3.73 1.45l2.8-2.8C16.84 3.35 14.63 2.4 12 2.4a9.74 9.74 0 0 0-8.72 5.38l3.25 2.53C7.3 8 9.46 6.28 12 6.28Z" /></svg>
}

function AuthField({ label, name, icon, suffix, form, ...props }: { label: string; name: keyof AuthFormValues; icon: React.ReactNode; suffix?: React.ReactNode; form: UseFormReturn<AuthFormValues> } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'name' | 'form'>) {
  const error = form.formState.errors[name]?.message
  return <label className="auth-field"><span className="auth-label">{label}</span><span className={`auth-input-wrap ${error ? 'has-error' : ''}`}><span className="auth-input-icon">{icon}</span><input {...props} {...form.register(name)} aria-invalid={Boolean(error)} aria-describedby={error ? `${name}-error` : undefined} />{suffix}</span>{error && <span className="auth-field-error" id={`${name}-error`} role="alert">{String(error)}</span>}</label>
}
