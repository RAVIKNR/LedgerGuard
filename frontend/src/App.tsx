import { useCallback, useEffect, useMemo, useRef, useState, useLayoutEffect, type ReactNode } from 'react'
import axios from 'axios'
import { motion, useReducedMotion } from 'framer-motion'
import Lenis from 'lenis'
import gsap from 'gsap'
import { Activity, ArrowDownLeft, ArrowUpRight, CircleHelp, Command, LayoutDashboard, Menu, Moon, Search, Settings, ShieldCheck, Sun, WalletCards, X, History, LogOut, Users, Check, Github, Instagram, Linkedin, Mail, Phone, Twitter, ExternalLink } from 'lucide-react'
import { BrowserRouter, Link, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Badge, Button, Card, Dialog, Skeleton, Tooltip } from './components/ui'
import { AuthPage } from './auth/AuthPage'
import { VerifyEmailPage } from './auth/VerifyEmailPage'
import { ForgotPasswordPage } from './auth/ForgotPasswordPage'
import { ResetPasswordPage } from './auth/ResetPasswordPage'
import { AuthProvider, useAuth, getApiErrorMessage } from './auth/AuthContext'
import { api } from './lib/api'
import { EmailVerification } from './components/EmailVerification'
import { AdminAccountsPage, AdminAuditPage, AdminFundingPage, AdminRolesPage, AdminTransactionMonitor, AdminUsersPage } from './components/AdminOperations'
import { LedgerObject } from './components/LedgerObject'
import { TransactionResultModal } from './components/TransactionResultModal'
import { publicContact } from './config/publicContact'
import { isSuccessSoundEnabled, setSuccessSoundEnabled } from './lib/successSound'
import { countries, type CountryOption } from './data/countries'

type BankingProfile = {
  name: string
  phone: string
  addressLine: string
  city: string
  region: string
  postalCode: string
  country: string
}

function isBankingProfileComplete(profile: BankingProfile) {
  return [
    profile.name,
    profile.addressLine,
    profile.city,
    profile.region,
    profile.postalCode,
    profile.country
  ].every((value) => typeof value === 'string' && value.trim().length > 0)
}

function findPhoneCountry(phone: string) {
  return [...countries].sort((a, b) => b.callingCode.length - a.callingCode.length)
    .find((country) => phone.startsWith(country.callingCode)) || countries[0]
}

function PhoneCountryPicker({ value, onChange }: { value: CountryOption; onChange: (country: CountryOption) => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const pickerRef = useRef<HTMLDivElement>(null)
  const filteredCountries = countries.filter((country) => `${country.name} ${country.callingCode}`.toLowerCase().includes(query.toLowerCase()))

  useEffect(() => {
    if (!open) return
    function closePicker(event: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', closePicker)
    return () => document.removeEventListener('mousedown', closePicker)
  }, [open])

  return <div className="phone-country-picker" ref={pickerRef}>
    <button type="button" className="phone-country-trigger" aria-haspopup="listbox" aria-expanded={open} aria-label="International calling code" onClick={() => { setOpen((current) => !current); setQuery('') }}>
      <span>{value.flag}</span><strong>{value.callingCode}</strong><span className="phone-country-chevron">▾</span>
    </button>
    {open && <div className="phone-country-menu">
      <input className="phone-country-search" autoFocus placeholder="Search countries" value={query} onChange={(event) => setQuery(event.target.value)} />
      <div className="phone-country-options" role="listbox" aria-label="International calling codes">
        {filteredCountries.map((country) => <button type="button" role="option" aria-selected={country.code === value.code} className={`phone-country-option${country.code === value.code ? ' selected' : ''}`} key={country.code} onClick={() => { onChange(country); setOpen(false); setQuery('') }}>
          <span>{country.flag}</span><span>{country.name}</span><strong>{country.callingCode}</strong>
        </button>)}
      </div>
    </div>}
  </div>
}

function ResidenceCountryPicker({ value, onChange }: { value: CountryOption; onChange: (country: CountryOption) => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const pickerRef = useRef<HTMLDivElement>(null)
  const filteredCountries = countries.filter((country) => country.name.toLowerCase().includes(query.toLowerCase()))

  useEffect(() => {
    if (!open) return
    function closePicker(event: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', closePicker)
    return () => document.removeEventListener('mousedown', closePicker)
  }, [open])

  return <div className="phone-country-picker residence-country-picker" ref={pickerRef}>
    <button type="button" className="phone-country-trigger residence-country-trigger" aria-haspopup="listbox" aria-expanded={open} aria-label="Country of residence" onClick={() => { setOpen((current) => !current); setQuery('') }}>
      <strong>{value.name}</strong><span className="phone-country-chevron">▾</span>
    </button>
    {open && <div className="phone-country-menu">
      <input className="phone-country-search" autoFocus placeholder="Search countries" value={query} onChange={(event) => setQuery(event.target.value)} />
      <div className="phone-country-options" role="listbox" aria-label="Countries of residence">
        {filteredCountries.map((country) => <button type="button" role="option" aria-selected={country.code === value.code} className={`phone-country-option residence-country-option${country.code === value.code ? ' selected' : ''}`} key={country.code} onClick={() => { onChange(country); setOpen(false); setQuery('') }}>
          <span>{country.name}</span>
        </button>)}
      </div>
    </div>}
  </div>
}

type Account = {
  id: string
  currency: string
  status: string
  holderName?: string | null
  accountNumber: string
  createdAt: string
}

type AccountBalance = Account & {
  balanceMinor: string
}

type TransferResult = {
  id: string
  reference?: string | null
  senderAccountId: string | null
  receiverAccountId: string | null
  senderAccountNumber?: string | null
  receiverAccountNumber?: string | null
  amountMinor: string
  currency: string
  status: string
  createdAt: string
  updatedAt?: string
  failureReason?: string | null
  availableBalanceMinor?: string | null
  risk?: { level: string; decision: string }
}

type TransferHistory = TransferResult & {
  reference: string | null
  direction: 'INCOMING' | 'OUTGOING'
  updatedAt: string
}

function formatTransferDate(value: string | undefined) {
  if (!value) return 'Date unavailable'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString()
}

function canPayAgain(transfer: TransferHistory) {
  return transfer.direction === 'OUTGOING' && transfer.status === 'COMPLETED' && Boolean(transfer.receiverAccountNumber)
}

function amountInputFromMinor(amountMinor: string) {
  const amount = BigInt(amountMinor)
  return `${amount / 100n}.${String(amount % 100n).padStart(2, '0')}`
}

function normalizeTransferHistory(value: unknown): TransferHistory | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (
    typeof record.id !== 'string' ||
    (record.direction !== 'INCOMING' && record.direction !== 'OUTGOING') ||
    typeof record.amountMinor !== 'string' ||
    typeof record.currency !== 'string' ||
    typeof record.status !== 'string' ||
    typeof record.createdAt !== 'string'
  ) return null

  return {
    id: record.id,
    reference: typeof record.reference === 'string' ? record.reference : null,
    direction: record.direction,
    senderAccountId: typeof record.senderAccountId === 'string' ? record.senderAccountId : null,
    receiverAccountId: typeof record.receiverAccountId === 'string' ? record.receiverAccountId : null,
    senderAccountNumber: typeof record.senderAccountNumber === 'string' ? record.senderAccountNumber : null,
    receiverAccountNumber: typeof record.receiverAccountNumber === 'string' ? record.receiverAccountNumber : null,
    amountMinor: record.amountMinor,
    currency: record.currency,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : record.createdAt,
    failureReason: typeof record.failureReason === 'string' ? record.failureReason : null,
    availableBalanceMinor: typeof record.availableBalanceMinor === 'string' ? record.availableBalanceMinor : null,
    risk: record.risk && typeof record.risk === 'object' ? record.risk as TransferHistory['risk'] : undefined
  }
}

type FlaggedTransfer = TransferResult & {
  risk: { score: number; level: string; decision: string; reasons: string[] }
}

function formatMoney(minor: string, currency: string) {
  const amount = Number(minor) / 100
  if (!Number.isSafeInteger(Number(minor)) || !Number.isFinite(amount)) return 'Balance unavailable'
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount)
}

function getDetailedApiErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError<{ error?: { details?: Array<{ msg?: string }> } }>(error)) {
    const validationMessages = error.response?.data?.error?.details
      ?.map((detail) => detail.msg)
      .filter((message): message is string => Boolean(message))
    if (validationMessages?.length) return [...new Set(validationMessages)].join('. ')
  }
  return getApiErrorMessage(error, fallback)
}

function toMinorUnits(value: string) {
  const normalized = value.trim()
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null
  const [whole, fraction = ''] = normalized.split('.')
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  return minor > 0n && minor <= BigInt(Number.MAX_SAFE_INTEGER) ? minor.toString() : null
}

function Dashboard() {
  const location = useLocation()
  const navigate = useNavigate()
  const [dark, setDark] = useState(() => localStorage.getItem('ledgerguard-theme') !== 'light')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [accounts, setAccounts] = useState<AccountBalance[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [transferOpen, setTransferOpen] = useState(false)
  const [payAgainTransfer, setPayAgainTransfer] = useState<TransferHistory | null>(null)
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [transfers, setTransfers] = useState<TransferHistory[]>([])
  const [transferPage, setTransferPage] = useState({ page: 1, pageSize: 10, total: 0, totalPages: 0 })
  const [transferFilters, setTransferFilters] = useState({ search: '', status: '', direction: '' })
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [detail, setDetail] = useState<TransferHistory | null>(null)
  const [setupOpen, setSetupOpen] = useState(false)
  const [setupSteps, setSetupSteps] = useState<string[]>([])
  const [setupLoading, setSetupLoading] = useState(false)
  const [fundingNotice, setFundingNotice] = useState('')
  const [fundingError, setFundingError] = useState('')
  const [demoRecipientAccountNumber, setDemoRecipientAccountNumber] = useState('')
  const [copyFeedback, setCopyFeedback] = useState('')
  const contentRef = useRef<HTMLDivElement>(null)
  const { user, logout } = useAuth()
  const reduceMotion = useReducedMotion()
  const motionProps = reduceMotion ? {} : { initial: { y: 10 }, animate: { y: 0 }, transition: { duration: 0.35 } }
  const page = location.pathname === '/' ? 'dashboard' : location.pathname.slice(1)
  const setTheme = (next: boolean) => {
    setDark(next)
    localStorage.setItem('ledgerguard-theme', next ? 'dark' : 'light')
    document.documentElement.dataset.theme = next ? 'dark' : 'light'
  }
  const loadDashboard = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await api.get<{ accounts: Account[] }>('/accounts')
      const balances = await Promise.all(response.data.accounts.map(async (account) => {
        const balance = await api.get<{ balanceMinor: string; currency: string; status: string }>(`/accounts/${account.id}/balance`)
        return { ...account, balanceMinor: balance.data.balanceMinor, currency: balance.data.currency, status: balance.data.status }
      }))
      if (balances.length) {
        try {
          const funding = await api.post<{ funded: boolean; accountId: string; balanceMinor: string; recipientAccountNumber: string }>('/funding/initial-demo')
          if (funding.data.recipientAccountNumber) setDemoRecipientAccountNumber(funding.data.recipientAccountNumber)
          if (funding.data.funded || funding.data.recipientAccountNumber) {
            setFundingNotice('Welcome to LedgerGuard!')
            setAccounts(balances.map((account) => account.id === funding.data.accountId
              ? { ...account, balanceMinor: funding.data.balanceMinor }
              : account))
          } else {
            setAccounts(balances)
          }
          setFundingError('')
        } catch (fundingRequestError) {
          if (!(axios.isAxiosError(fundingRequestError) && fundingRequestError.response?.status === 409)) {
            setFundingError(getApiErrorMessage(fundingRequestError, 'Demo funding could not be confirmed. Retry safely.'))
          }
          setAccounts(balances)
        }
      } else {
        setAccounts(balances)
      }
      setSelectedAccountId((current) => current || balances[0]?.id || '')
    } catch (requestError) {
      if (axios.isAxiosError(requestError) && requestError.response?.status === 401) {
        await logout()
        return
      }
      setError(getApiErrorMessage(requestError, 'We could not load your account overview.'))
    } finally {
      setLoading(false)
    }
  }, [logout])

  const openTransfer = useCallback(async () => {
    setSetupLoading(true)
    try {
      const [profileResponse, verificationResponse, accountsResponse] = await Promise.all([
        api.get<{ user: { name: string; profile: BankingProfile } }>('/users/me'),
        api.get<{ verified: boolean }>('/users/me/email-otp/status'),
        api.get<{ accounts: Account[] }>('/accounts')
      ])
      const profile = {
        name: profileResponse.data.user.name || '',
        phone: profileResponse.data.user.profile.phone || '',
        addressLine: profileResponse.data.user.profile.addressLine || '',
        city: profileResponse.data.user.profile.city || '',
        region: profileResponse.data.user.profile.region || '',
        postalCode: profileResponse.data.user.profile.postalCode || '',
        country: profileResponse.data.user.profile.country || ''
      }
      const missing: string[] = []
      if (!verificationResponse.data.verified) missing.push('Email verification')
      if (!isBankingProfileComplete(profile)) missing.push('Required profile details')
      if (!accountsResponse.data.accounts.length) missing.push('Demo account readiness')
      if (missing.length) {
        setSetupSteps(missing)
        setSetupOpen(true)
      } else {
        setTransferOpen(true)
      }
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'We could not verify your setup status.'))
    } finally {
      setSetupLoading(false)
    }
  }, [navigate])

  const loadTransfers = useCallback(async () => {
    if (!selectedAccountId) {
      setTransfers([])
      return
    }
    setHistoryLoading(true)
    setHistoryError('')
    try {
      const params = new URLSearchParams({
        page: String(transferPage.page),
        pageSize: String(transferPage.pageSize),
        ...(transferFilters.search ? { search: transferFilters.search } : {}),
        ...(transferFilters.status ? { status: transferFilters.status } : {}),
        ...(transferFilters.direction ? { direction: transferFilters.direction } : {})
      })
      const response = await api.get<{ transfers: TransferHistory[]; pagination: typeof transferPage }>(`/accounts/${selectedAccountId}/transfers?${params}`)
      setTransfers(Array.isArray(response.data.transfers)
        ? response.data.transfers.map(normalizeTransferHistory).filter((transfer): transfer is TransferHistory => transfer !== null)
        : [])
      setTransferPage(response.data.pagination)
    } catch (requestError) {
      if (axios.isAxiosError(requestError) && requestError.response?.status === 401) {
        await logout()
        return
      }
      setHistoryError(getApiErrorMessage(requestError, 'We could not load transaction history.'))
    } finally {
      setHistoryLoading(false)
    }
  }, [logout, selectedAccountId, transferFilters, transferPage.page, transferPage.pageSize])

  useEffect(() => { void loadTransfers() }, [loadTransfers])

  useEffect(() => {
    void loadDashboard()
  }, [loadDashboard])

  const currencyGroups = useMemo(() => accounts.reduce<Record<string, AccountBalance[]>>((groups, account) => {
    groups[account.currency] = [...(groups[account.currency] || []), account]
    return groups
  }, {}), [accounts])
  const currencyTotals = useMemo(() => Object.fromEntries(Object.entries(currencyGroups).map(([currency, grouped]) => [
    currency,
    grouped.reduce((total, account) => {
      try { return total + BigInt(account.balanceMinor) } catch { return total }
    }, 0n).toString()
  ])), [currencyGroups])

  return <div className={`app-shell ${dark ? 'dark' : 'light'}`} data-theme={dark ? 'dark' : 'light'}>
    <button className="mobile-menu" onClick={() => setMobileOpen(!mobileOpen)} aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}>{mobileOpen ? <X /> : <Menu />}</button>
    <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
      <div className="brand"><div className="brand-mark"><ShieldCheck size={18} /></div><span>ledger<span>guard</span></span></div>
      <div className="workspace-label">Workspace</div>
      <button className="workspace-switch" onClick={() => navigate('/accounts')}><div className="workspace-avatar">L</div><div><strong>LedgerGuard HQ</strong><small>Personal workspace</small></div></button>
      <nav aria-label="Primary navigation"><div className="nav-label">Overview</div><NavItem onClick={() => setMobileOpen(false)} to="/" active={page === 'dashboard'} icon={<LayoutDashboard size={17} />}>Dashboard</NavItem><NavItem onClick={() => setMobileOpen(false)} to="/transfers" active={page === 'transfers'} icon={<ArrowUpRight size={17} />}>Transfers</NavItem><NavItem onClick={() => setMobileOpen(false)} to="/accounts" active={page === 'accounts'} icon={<WalletCards size={17} />}>Accounts</NavItem><NavItem onClick={() => setMobileOpen(false)} to="/history" active={page === 'history'} icon={<History size={17} />}>Transaction history</NavItem><div className="nav-label">Administration</div><NavItem onClick={() => setMobileOpen(false)} to="/admin" active={false} icon={<ShieldCheck size={17} />}>Admin portal</NavItem><div className="nav-label">Workspace</div><NavItem onClick={() => setMobileOpen(false)} to="/settings" active={page === 'settings'} icon={<Settings size={17} />}>Settings</NavItem></nav>
      <div className="sidebar-bottom"><NavItem onClick={() => setMobileOpen(false)} to="/help" active={page === 'help'} icon={<CircleHelp size={17} />}>Help center</NavItem><div className="profile"><div className="profile-avatar">{user?.name.slice(0, 2).toUpperCase() || 'LG'}</div><div><strong>{user?.name || 'LedgerGuard user'}</strong><small>{user?.email || 'Authenticated'}</small></div><button className="profile-logout" onClick={() => void logout()} aria-label="Sign out"><LogOut size={14} /></button></div></div>
    </aside>
    <main className="main-content" id="dashboard">
      <header className="topbar"><div className="breadcrumbs"><span>Workspace</span><b>/</b><strong>{pageTitle(page)}</strong></div><div className="topbar-actions"><button className="search" aria-label="Search transfers" onClick={() => navigate('/history')}><Search size={15} /><span>Search transfers</span><kbd><Command size={10} /> K</kbd></button><Tooltip label={dark ? 'Switch to light theme' : 'Switch to dark theme'}><button className="icon-button" onClick={() => setTheme(!dark)} aria-label="Toggle theme">{dark ? <Sun size={16} /> : <Moon size={16} />}</button></Tooltip></div></header>
      <div className="content-wrap" ref={contentRef}>
        <PageTransition routeKey={location.pathname} reducedMotion={reduceMotion}>
        {page !== 'dashboard' && <RoutePage page={page} accounts={accounts} loading={loading} error={error} onRefresh={() => void loadDashboard()} onTransfer={() => { setPayAgainTransfer(null); setTransferOpen(true) }} onPayAgain={(transfer) => { setPayAgainTransfer(transfer); setTransferOpen(true) }} />}
        {page === 'dashboard' && <>
        <motion.section className="welcome" {...motionProps}><div><div className="eyebrow"><Activity size={13} /> Account overview</div><h1>Good morning, {user?.name.split(' ')[0] || 'there'}<span>.</span></h1><p>Your balances are read directly from the LedgerGuard ledger.</p></div><LedgerObject className="dashboard-installation" /><div className="welcome-actions"><Button onClick={() => void openTransfer()} disabled={setupLoading}> <ArrowUpRight size={16} /> {setupLoading ? 'Checking setup…' : 'New transfer'}</Button><Button onClick={() => void loadDashboard()} variant="secondary">{loading ? 'Refreshing…' : 'Refresh balances'}</Button></div></motion.section>
        {error && <Card className="dashboard-error"><div><strong>Could not load your dashboard</strong><p>{error}</p></div><Button size="sm" onClick={() => void loadDashboard()}>Try again</Button></Card>}
        {fundingError && <Card className="dashboard-error"><div><strong>Demo funding needs confirmation</strong><p>{fundingError}</p></div><Button size="sm" onClick={() => void loadDashboard()}>Retry</Button></Card>}
        {fundingNotice && demoRecipientAccountNumber && <Card className="profile-success funding-success" role="status"><strong>{fundingNotice}</strong><p>Your developer-provided demo funds have been credited successfully.</p><p><strong>₹10,000.00 credited</strong></p><p><strong>Try your first demo transfer</strong></p><div className="demo-recipient"><span>Demo recipient account number: <strong>{demoRecipientAccountNumber}</strong></span><Button size="sm" variant="secondary" onClick={() => { void navigator.clipboard.writeText(demoRecipientAccountNumber).then(() => setCopyFeedback('Account number copied.')).catch(() => setCopyFeedback('Could not copy the account number.')) }}>{copyFeedback || 'Copy Account Number'}</Button></div><small>Demo Mode — No real money involved.</small></Card>}
        <motion.section className="stats-grid motion-stagger" id="accounts" initial={reduceMotion ? false : 'hidden'} animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: .045, delayChildren: .08 } } }}>
          <SummaryCard label="Accounts" value={loading ? '—' : String(accounts.length)} detail={accounts.length ? 'Connected accounts' : 'Create your first account'} icon={<WalletCards size={17} />} tone="emerald" loading={loading} />
          <SummaryCard label="INR balance" value={loading ? '—' : currencyTotals.INR ? formatMoney(currencyTotals.INR, 'INR') : 'No INR account'} detail="Same-currency total" icon={<Activity size={17} />} tone="mint" loading={loading} />
          <SummaryCard label="Account status" value={loading ? '—' : accounts.length && accounts.every((account) => account.status === 'ACTIVE') ? 'Active' : 'Review' } detail={loading ? 'Checking accounts' : 'Based on account status'} icon={<ShieldCheck size={17} />} tone="amber" loading={loading} />
        </motion.section>
        <section className="dashboard-grid">
          <Card className="balance-panel"><PanelHeading kicker="Authoritative balances" title="Your accounts"><span className="panel-meta"><Badge tone="neutral">DEMO MODE — NO REAL MONEY INVOLVED</Badge> {accounts.length} account{accounts.length === 1 ? '' : 's'}</span></PanelHeading>{loading ? <div className="account-list">{[1, 2].map((item) => <div className="account-row" key={item}><Skeleton className="account-skeleton-icon" /><div className="account-info"><Skeleton className="skeleton-line" /><Skeleton className="skeleton-line short" /></div><Skeleton className="balance-skeleton" /></div>)}</div> : accounts.length ? <div className="account-list">{accounts.map((account) => <div className="account-row" key={account.id}><div className="account-icon"><WalletCards size={17} /></div><div className="account-info"><strong>{account.currency} account</strong>          <span>{account.accountNumber} · {account.status.toLowerCase()}</span></div><div className="account-balance"><strong>{formatMoney(account.balanceMinor, account.currency)}</strong><span>Available ledger balance · simulated only</span></div></div>)}</div> : <EmptyState title="No accounts yet" message="Create an account to see its authoritative balance here." />}</Card>
          <Card className="activity-panel" id="activity"><PanelHeading kicker="Account history" title="Transfers"><Badge tone={historyLoading ? 'neutral' : 'success'}>{historyLoading ? 'Loading' : 'Authorized data'}</Badge></PanelHeading><div className="history-controls"><select className="ui-input" value={selectedAccountId} onChange={(event) => { setSelectedAccountId(event.target.value); setTransferPage((page) => ({ ...page, page: 1 })) }}><option value="">Choose account</option>{accounts.map((account) =>           <option value={account.id} key={account.id}>{account.currency} · {account.accountNumber}</option>)}</select><input className="ui-input" placeholder="Search reference or ID" value={transferFilters.search} onChange={(event) => { setTransferFilters({ ...transferFilters, search: event.target.value }); setTransferPage((page) => ({ ...page, page: 1 })) }} /><select className="ui-input" value={transferFilters.direction} onChange={(event) => { setTransferFilters({ ...transferFilters, direction: event.target.value }); setTransferPage((page) => ({ ...page, page: 1 })) }}><option value="">All directions</option><option value="INCOMING">Incoming</option><option value="OUTGOING">Outgoing</option></select><select className="ui-input" value={transferFilters.status} onChange={(event) => { setTransferFilters({ ...transferFilters, status: event.target.value }); setTransferPage((page) => ({ ...page, page: 1 })) }}>          <option value="">All statuses</option><option value="COMPLETED">Completed</option><option value="PENDING">Pending</option><option value="PROCESSING">Processing</option><option value="REVIEW">Review</option><option value="FAILED">Failed</option></select></div>{historyError && <div className="form-error" role="alert">{historyError} <button className="text-button" onClick={() => void loadTransfers()}>Retry</button></div>}{historyLoading ? <div className="table-loading"><Skeleton className="skeleton-line" /><Skeleton className="skeleton-line" /><Skeleton className="skeleton-line" /></div> : transfers.length ? <div className="history-list">{transfers.map((transfer) => <div className="history-row-wrap" key={transfer.id}><button className="history-row" key={transfer.id} onClick={async () => { try { const response = await api.get<{ transfer: TransferHistory }>(`/accounts/transfers/${transfer.id}`); setDetail(response.data.transfer) } catch (requestError) { setHistoryError(getApiErrorMessage(requestError, 'We could not load this transfer.')) } }}><span className={`history-direction ${transfer.direction.toLowerCase()}`}>{transfer.direction === 'INCOMING' ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}</span><span className="history-main"><strong>{transfer.reference || `${transfer.direction.toLowerCase()} transfer`}</strong>                    <small>{formatTransferDate(transfer.createdAt)} · {transfer.senderAccountNumber || 'External source'} → {transfer.receiverAccountNumber || 'Unknown recipient'}</small>{transfer.status === 'FAILED' && <small className="history-failure-reason">{transfer.failureReason || 'Transfer rejected'}</small>}</span><span className="history-amount"><strong>{transfer.direction === 'INCOMING' ? '+' : '−'}{formatMoney(transfer.amountMinor, transfer.currency)}</strong><Badge tone={transfer.status === 'COMPLETED' ? 'success' : transfer.status === 'FAILED' ? 'danger' : transfer.status === 'REVIEW' ? 'warning' : 'neutral'}>{transfer.status}</Badge></span></button>{canPayAgain(transfer) && <Button size="sm" variant="secondary" onClick={() => { setPayAgainTransfer(transfer); setTransferOpen(true) }}>Pay Again</Button>}</div>)}</div> : <EmptyState title="No transfers found" message="Try another account or adjust the filters." />}<div className="pagination"><span>{transferPage.total} total</span><div><Button size="sm" variant="ghost" disabled={transferPage.page <= 1} onClick={() => setTransferPage((page) => ({ ...page, page: page.page - 1 }))}>Previous</Button><span>Page {transferPage.page} of {Math.max(transferPage.totalPages, 1)}</span><Button size="sm" variant="ghost" disabled={transferPage.page >= transferPage.totalPages}           onClick={() => setTransferPage((page) => ({ ...page, page: page.page + 1 }))}>Next</Button></div></div></Card>
        </section>
        <Card className="table-card"><PanelHeading kicker="Account information" title="Available balances"><Badge tone={accounts.length ? 'success' : 'neutral'}>{accounts.length ? 'Live data' : 'No data'}</Badge></PanelHeading>{loading ? <div className="table-loading"><Skeleton className="skeleton-line" /><Skeleton className="skeleton-line" /><Skeleton className="skeleton-line" /></div> : accounts.length ? <div className="table-wrap"><table><thead><tr><th>Account number</th><th>Currency</th><th>Status</th><th className="table-right">Balance</th></tr></thead><tbody>{accounts.map((account) => <tr key={account.id}><td><strong>{account.accountNumber}</strong></td><td>{account.currency}</td><td><Badge tone={account.status === 'ACTIVE' ? 'success' : 'warning'}>{account.status}</Badge></td><td className="table-right"><strong>{formatMoney(account.balanceMinor, account.currency)}</strong></td></tr>)}</tbody></table></div> : <EmptyState title="Nothing to summarize" message="Once an account exists, its balance and status will appear here." />}</Card>
        <div className="footer-note"><ShieldCheck size={14} /> Balances sourced from the LedgerGuard API <span>•</span> Refresh when needed</div>
        </>}
        </PageTransition>
      </div>
    </main>
    <TransferDialog open={transferOpen} accounts={accounts} initialTransfer={payAgainTransfer} onClose={() => { setTransferOpen(false); setPayAgainTransfer(null) }} onCompleted={() => { void loadDashboard(); void loadTransfers() }} />
    {setupOpen && <Dialog open title="Complete Your Setup" onClose={() => setSetupOpen(false)}><p className="page-copy">Complete your profile and account setup before making your first transfer.</p><ul className="setup-checklist">{setupSteps.map((step) => <li key={step}><span className="empty-icon"><Check size={14} /></span>{step}</li>)}</ul><div className="dialog-actions"><Button variant="ghost" onClick={() => setSetupOpen(false)}>Maybe Later</Button><Button onClick={() => { setSetupOpen(false); navigate('/accounts') }}>{setupLoading ? 'Checking…' : 'Complete Setup'}</Button></div></Dialog>}
    {detail && <Dialog open title="Transfer details" onClose={() => setDetail(null)}><div className="review-list"><ReviewRow label="Reference" value={detail.reference || detail.id} /><ReviewRow label="Direction" value={detail.direction} /><ReviewRow label="Amount" value={formatMoney(detail.amountMinor, detail.currency)} /><ReviewRow label="Status" value={detail.status} /><ReviewRow label="Created" value={new Date(detail.createdAt).toLocaleString()} /></div><div className="dialog-actions">{canPayAgain(detail) && <Button onClick={() => { setDetail(null); setPayAgainTransfer(detail); setTransferOpen(true) }}>Pay Again</Button>}<Button onClick={() => setDetail(null)}>Close</Button></div></Dialog>}
  </div>
}

function NavItem({ to, active, icon, children, onClick }: { to: string; active: boolean; icon: ReactNode; children: ReactNode; onClick?: () => void }) {
  return <Link className={`nav-item ${active ? 'active' : ''}`} to={to} onClick={onClick}>{icon}{children}</Link>
}

function pageTitle(page: string) {
  return ({ dashboard: 'Dashboard', transfers: 'Transfers', accounts: 'Accounts', history: 'Transaction history', risk: 'Risk & review', settings: 'Settings', help: 'Help center' } as Record<string, string>)[page] || 'LedgerGuard'
}

function RoutePage({ page, accounts, loading, error, onRefresh, onTransfer, onPayAgain }: { page: string; accounts: AccountBalance[]; loading: boolean; error: string; onRefresh: () => void; onTransfer: () => void; onPayAgain: (transfer: TransferHistory) => void }) {
  if (page === 'transfers' || page === 'history') return <TransferPage accounts={accounts} historyOnly={page === 'history'} onTransfer={onTransfer} onPayAgain={onPayAgain} />
  if (page === 'accounts') return <AccountsPage accounts={accounts} loading={loading} error={error} onRefresh={onRefresh} />
  if (page === 'settings') return <SettingsPage />
  if (page === 'help') return <HelpPage />
  return <Card><PanelHeading kicker="LedgerGuard" title="Page not found" /><EmptyState title="This workspace page does not exist" message="Choose a page from the navigation." /></Card>
}

type AdminOverview = {
  totalUsers: number
  totalAccounts: number
  totalTransfers: number
  pendingTransfers: number
}

function AdminPortal() {
  const { user, logout } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [overview, setOverview] = useState<AdminOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [denied, setDenied] = useState(false)
  const [error, setError] = useState('')
  const reduceMotion = useReducedMotion()
  const page = location.pathname.replace(/\/+$/, '')
  const contentRef = useRef<HTMLDivElement>(null)

  const loadOverview = useCallback(async () => {
    setLoading(true)
    setDenied(false)
    setError('')
    try {
      const response = await api.get<{ overview: AdminOverview }>('/admin/overview')
      setOverview(response.data.overview)
    } catch (requestError) {
      if (axios.isAxiosError(requestError) && requestError.response?.status === 401) {
        await logout()
      } else if (axios.isAxiosError(requestError) && requestError.response?.status === 403) {
        setDenied(true)
      } else {
        setError(getApiErrorMessage(requestError, 'We could not load the administrator overview.'))
      }
    } finally {
      setLoading(false)
    }
  }, [logout])

  useEffect(() => { void loadOverview() }, [loadOverview])

  if (denied) return <main className="admin-denied-page">
    <Card className="admin-denied-card">
      <div className="brand-mark"><ShieldCheck size={18} /></div>
      <span className="section-kicker">Restricted workspace</span>
      <h1>Administrator access required</h1>
      <p>This signed-in account is not configured for LedgerGuard administration. Frontend navigation cannot grant administrator access.</p>
      <div className="dialog-actions"><Button variant="secondary" onClick={() => navigate('/')}>Return to LedgerGuard</Button><Button variant="ghost" onClick={() => void logout()}>Sign out</Button></div>
    </Card>
  </main>

  const section = page === '/admin/transfers' ? 'transfers'
    : page === '/admin/funding' ? 'funding'
    : page === '/admin/users' ? 'users'
      : page === '/admin/accounts' ? 'accounts'
        : page === '/admin/audit' ? 'audit'
          : page === '/admin/roles' ? 'roles'
          : 'overview'
  const title = section === 'transfers' ? 'Transfer review'
    : section === 'funding' ? 'Admin transfer'
    : section === 'users' ? 'User management'
      : section === 'accounts' ? 'Account operations'
        : section === 'audit' ? 'Audit log'
        : section === 'roles' ? 'Administrator roles'
        : 'Admin overview'

  return <div className="app-shell admin-portal">
    <button className="mobile-menu" onClick={() => setMobileOpen(!mobileOpen)} aria-label={mobileOpen ? 'Close admin navigation' : 'Open admin navigation'}>{mobileOpen ? <X /> : <Menu />}</button>
    <aside className={`sidebar admin-sidebar ${mobileOpen ? 'open' : ''}`}>
      <div className="brand"><div className="brand-mark"><ShieldCheck size={18} /></div><span>ledger<span>guard</span></span></div>
      <div className="admin-sidebar-title">Administration</div>
      <nav aria-label="Admin navigation">
        <NavItem onClick={() => setMobileOpen(false)} to="/admin" active={section === 'overview'} icon={<LayoutDashboard size={17} />}>Overview</NavItem>
        <NavItem onClick={() => setMobileOpen(false)} to="/admin/transfers" active={section === 'transfers'} icon={<ArrowUpRight size={17} />}>Transfer review</NavItem>
        <div className="admin-nav-group-label">Operations</div>
        <NavItem onClick={() => setMobileOpen(false)} to="/admin/funding" active={section === 'funding'} icon={<WalletCards size={17} />}>Admin transfer</NavItem>
        <NavItem onClick={() => setMobileOpen(false)} to="/admin/users" active={section === 'users'} icon={<Users size={17} />}>User management</NavItem>
        <NavItem onClick={() => setMobileOpen(false)} to="/admin/accounts" active={section === 'accounts'} icon={<WalletCards size={17} />}>Account operations</NavItem>
        <NavItem onClick={() => setMobileOpen(false)} to="/admin/audit" active={section === 'audit'} icon={<History size={17} />}>Audit log</NavItem>
        <NavItem onClick={() => setMobileOpen(false)} to="/admin/roles" active={section === 'roles'} icon={<ShieldCheck size={17} />}>Administrator roles</NavItem>
      </nav>
      <div className="sidebar-bottom">
        <NavItem onClick={() => navigate('/')} to="/" active={false} icon={<ArrowDownLeft size={17} />}>Return to LedgerGuard</NavItem>
        <div className="profile"><div className="profile-avatar">{user?.name.slice(0, 2).toUpperCase() || 'LG'}</div><div><strong>{user?.name || 'Administrator'}</strong><small>Authorized session</small></div><button className="profile-logout" onClick={() => void logout()} aria-label="Sign out"><LogOut size={14} /></button></div>
      </div>
    </aside>
    <main className="main-content">
      <header className="topbar"><div className="breadcrumbs"><span>LedgerGuard</span><b>/</b><strong>{title}</strong></div><div className="topbar-actions"><Badge tone="success">Restricted access</Badge><Button size="sm" variant="secondary" onClick={() => void loadOverview()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh overview'}</Button></div></header>
      <div className="content-wrap admin-content" ref={contentRef}>
        <PageTransition routeKey={location.pathname} reducedMotion={reduceMotion}>
        {loading && !overview ? <Card><PanelHeading kicker="Secure overview" title="Loading administrative metrics" /><div className="table-loading"><Skeleton className="skeleton-line" /><Skeleton className="skeleton-line" /></div></Card>
          : error ? <Card className="dashboard-error"><div><strong>Overview unavailable</strong><p>{error}</p></div><Button size="sm" onClick={() => void loadOverview()}>Retry</Button></Card>
            : section === 'users' ? <AdminUsersPage />
              : section === 'accounts' ? <AdminAccountsPage />
                : section === 'funding' ? <AdminFundingPage />
                : section === 'audit' ? <AdminAuditPage />
                    : section === 'roles' ? <AdminRolesPage />
                    : section === 'transfers' ? <AdminTransfersPage />
                : overview && <><div className="page-heading"><div><span className="section-kicker">Restricted workspace</span><h1>Admin overview</h1><p>Database-backed service totals. No user records or sensitive account details are exposed here.</p></div></div><section className="admin-summary-grid">
                  <SummaryCard label="Registered users" value={String(overview.totalUsers)} detail="Total user records" icon={<Users size={17} />} tone="emerald" />
                  <SummaryCard label="Currency accounts" value={String(overview.totalAccounts)} detail="Total account records" icon={<WalletCards size={17} />} tone="mint" />
                  <SummaryCard label="Transfers" value={String(overview.totalTransfers)} detail="Total transfer records" icon={<ArrowUpRight size={17} />} tone="blue" />
                  <SummaryCard label="Pending transfers" value={String(overview.pendingTransfers)} detail="Waiting in pending status" icon={<Activity size={17} />} tone="amber" />
                </section></>}
        </PageTransition>
      </div>
    </main>
  </div>
}

function AdminTransfersPage() {
  const { logout } = useAuth()
  const [transfers, setTransfers] = useState<FlaggedTransfer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [permission, setPermission] = useState<'unknown' | 'allowed' | 'denied'>('unknown')
  const [filter, setFilter] = useState('')
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const response = await api.get<{ transfers: FlaggedTransfer[] }>('/admin/transfers/flagged')
      setTransfers(response.data.transfers); setPermission('allowed')
    } catch (requestError) {
      if (axios.isAxiosError(requestError) && requestError.response?.status === 401) { await logout(); return }
      if (axios.isAxiosError(requestError) && requestError.response?.status === 403) { setPermission('denied'); return }
      setError(getApiErrorMessage(requestError, 'We could not load the administrator queue.'))
    } finally { setLoading(false) }
  }, [logout])
  useEffect(() => { void load() }, [load])
  const visible = transfers.filter((transfer) => !filter || transfer.risk.decision === filter)
  return <div>
    <AdminTransactionMonitor />
    <div className="page-heading"><div><span className="section-kicker">Restricted workspace</span><h1>Transfer review</h1><p>Review transfers awaiting administrator action.</p></div><Button variant="secondary" onClick={() => void load()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh admin data'}</Button></div>
    {permission === 'denied' && <Card><EmptyState title="Administrator access required" message="The backend denied this account. Frontend navigation does not grant administrator access." /></Card>}
    {permission !== 'denied' && <Card><PanelHeading kicker="Risk operations" title="Transfers awaiting review"><Badge tone={visible.length ? 'warning' : 'success'}>{`${visible.length} flagged`}</Badge></PanelHeading><div className="risk-toolbar"><span>Risk signals are not proof of fraud.</span><select aria-label="Risk decision" className="ui-input" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="">All flagged transfers</option><option value="REVIEW">Awaiting review</option></select></div>{error && <div className="form-error" role="alert">{error} <button className="text-button" onClick={() => void load()}>Retry</button></div>}{loading ? <div className="table-loading"><Skeleton className="skeleton-line" /><Skeleton className="skeleton-line" /></div> : visible.length ? <div className="risk-list">{visible.map((transfer) => <AdminTransferRow key={transfer.id} transfer={transfer} onDone={() => void load()} />)}</div> : <EmptyState title="No flagged transfers" message="The authorized admin queue is currently empty." />}</Card>}
  </div>
}

function AdminTransferRow({ transfer, onDone }: { transfer: FlaggedTransfer; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [decision, setDecision] = useState<'APPROVE' | 'DECLINE' | null>(null)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  async function confirm() {
    if (!decision) return
    setSaving(true); setError('')
    try { await api.post(`/admin/transfers/${transfer.id}/decision`, { decision, notes }); setOpen(false); onDone() } catch (requestError) { setError(getApiErrorMessage(requestError, 'The review action could not be completed.')) } finally { setSaving(false) }
  }
  return <><button className="risk-row" onClick={() => setOpen(true)}><span className={`risk-score ${transfer.risk.level.toLowerCase()}`}>{transfer.risk.score}</span><span className="history-main"><strong>{formatMoney(transfer.amountMinor, transfer.currency)} transfer</strong><small>{transfer.id.slice(0, 12)}… · {transfer.risk.reasons.join(' ')}</small></span><Badge tone="warning">{transfer.risk.level} · {transfer.risk.decision}</Badge></button>{open && <Dialog open title="Review transfer" onClose={() => !saving && setOpen(false)}><div className="risk-detail"><div className="review-list"><ReviewRow label="Transfer" value={transfer.id} /><ReviewRow label="Amount" value={formatMoney(transfer.amountMinor, transfer.currency)} /><ReviewRow label="Status" value={transfer.status} /></div><label className="field"><span className="field-label">Review notes (optional)</span><textarea className="ui-input" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} /></label>{error && <div className="form-error" role="alert">{error}</div>}{decision ? <div className="confirm-box"><p>Confirm {decision.toLowerCase()} this transfer?</p><div className="dialog-actions"><Button variant="ghost" onClick={() => setDecision(null)} disabled={saving}>Cancel</Button><Button onClick={() => void confirm()} disabled={saving}>{saving ? 'Saving…' : `Confirm ${decision.toLowerCase()}`}</Button></div></div> : <div className="dialog-actions"><Button variant="danger" onClick={() => setDecision('DECLINE')}>Decline</Button><Button onClick={() => setDecision('APPROVE')}>Approve</Button></div>}</div></Dialog>}</>
}

function TransferPage({ accounts, historyOnly, onTransfer, onPayAgain }: { accounts: AccountBalance[]; historyOnly: boolean; onTransfer: () => void; onPayAgain: (transfer: TransferHistory) => void }) {
  const { logout } = useAuth()
  const [accountId, setAccountId] = useState(accounts[0]?.id || '')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [direction, setDirection] = useState('')
  const [rows, setRows] = useState<TransferHistory[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [detail, setDetail] = useState<TransferHistory | null>(null)
  const [page, setPage] = useState({ page: 1, pageSize: 10, total: 0, totalPages: 0 })
  const load = useCallback(async () => {
    if (!accountId) { setRows([]); return }
    setLoading(true); setError('')
    try {
      const params = new URLSearchParams({ page: String(page.page), pageSize: String(page.pageSize), ...(search ? { search } : {}), ...(status ? { status } : {}), ...(direction ? { direction } : {}) })
      const response = await api.get<{ transfers: TransferHistory[]; pagination: typeof page }>(`/accounts/${accountId}/transfers?${params}`)
      setRows(Array.isArray(response.data.transfers)
        ? response.data.transfers.map(normalizeTransferHistory).filter((transfer): transfer is TransferHistory => transfer !== null)
        : [])
      setPage(response.data.pagination)
    } catch (requestError) {
      if (axios.isAxiosError(requestError) && requestError.response?.status === 401) { await logout(); return }
      setError(getApiErrorMessage(requestError, 'We could not load transfers.'))
    } finally { setLoading(false) }
  }, [accountId, direction, logout, page.page, page.pageSize, search, status])
  useEffect(() => { void load() }, [load])
  useEffect(() => { if (!accountId && accounts[0]) setAccountId(accounts[0].id) }, [accountId, accounts])
  return <div><div className="page-heading"><div><span className="section-kicker">{historyOnly ? 'Ledger activity' : 'Money movement'}</span><h1>{historyOnly ? 'Transaction history' : 'Transfers'}</h1><p>{historyOnly ? 'Search and inspect authorized transfer activity.' : 'Create a transfer using the backend idempotency safeguards.'}</p></div>{!historyOnly && <Button onClick={onTransfer}><ArrowUpRight size={16} /> New transfer</Button>}</div><Card className="table-card"><div className="history-controls"><select aria-label="Account" className="ui-input" value={accountId} onChange={(event) => { setAccountId(event.target.value); setPage((current) => ({ ...current, page: 1 })) }}><option value="">Choose account</option>{accounts.map((account) => <option value={account.id} key={account.id}>{account.currency} · {account.accountNumber}</option>)}</select><input aria-label="Search transfers" className="ui-input" placeholder="Search reference or ID" value={search} onChange={(event) => { setSearch(event.target.value); setPage((current) => ({ ...current, page: 1 })) }} /><select aria-label="Direction" className="ui-input" value={direction} onChange={(event) => { setDirection(event.target.value); setPage((current) => ({ ...current, page: 1 })) }}><option value="">All directions</option><option value="INCOMING">Incoming</option><option value="OUTGOING">Outgoing</option></select><select aria-label="Status" className="ui-input" value={status} onChange={(event) => { setStatus(event.target.value); setPage((current) => ({ ...current, page: 1 })) }}>  <option value="">All statuses</option><option value="COMPLETED">Completed</option><option value="PENDING">Pending</option><option value="PROCESSING">Processing</option><option value="REVIEW">Review</option><option value="FAILED">Failed</option></select></div>{error && <div className="form-error" role="alert">{error} <button className="text-button" onClick={() => void load()}>Retry</button></div>}{loading ? <div className="table-loading"><Skeleton className="skeleton-line" /><Skeleton className="skeleton-line" /><Skeleton className="skeleton-line" /></div> : rows.length ? <div className="history-list">{rows.map((transfer) => <div className="history-row-wrap" key={transfer.id}><button className="history-row" onClick={async () => { try { const response = await api.get<{ transfer: TransferHistory }>(`/accounts/transfers/${transfer.id}`); setDetail(response.data.transfer) } catch (requestError) { setError(getApiErrorMessage(requestError, 'We could not load this transfer.')) } }}><span className={`history-direction ${transfer.direction.toLowerCase()}`}>{transfer.direction === 'INCOMING' ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}</span><span className="history-main"><strong>{transfer.reference || `${transfer.direction.toLowerCase()} transfer`}</strong>  <small>{formatTransferDate(transfer.createdAt)} · {transfer.senderAccountNumber || 'External source'} → {transfer.receiverAccountNumber || 'Unknown recipient'}</small>{transfer.status === 'FAILED' && <small className="history-failure-reason">{transfer.failureReason || 'Transfer rejected'}</small>}</span><span className="history-amount"><strong>{transfer.direction === 'INCOMING' ? '+' : '−'}{formatMoney(transfer.amountMinor, transfer.currency)}</strong><Badge tone={transfer.status === 'COMPLETED' ? 'success' : transfer.status === 'FAILED' ? 'danger' : transfer.status === 'REVIEW' ? 'warning' : 'neutral'}>{transfer.status}</Badge></span></button>{canPayAgain(transfer) && <Button size="sm" variant="secondary" onClick={() => onPayAgain(transfer)}>Pay Again</Button>}</div>)}</div> : <EmptyState title="No transfers found" message="Try another account or adjust the filters." />}<div className="pagination"><span>{page.total} total</span><div><Button size="sm" variant="ghost" disabled={page.page <= 1} onClick={() => setPage((current) => ({ ...current, page: current.page - 1 }))}>Previous</Button><span>Page {page.page} of {Math.max(page.totalPages, 1)}</span><Button size="sm" variant="ghost" disabled={page.page >= page.totalPages} onClick={() => setPage((current) => ({ ...current, page: current.page + 1 }))}>Next</Button></div></div></Card>{detail && <Dialog open title="Transfer details" onClose={() => setDetail(null)}><div className="review-list"><ReviewRow label="Reference" value={detail.reference || detail.id} /><ReviewRow label="Direction" value={detail.direction} /><ReviewRow label="Amount" value={formatMoney(detail.amountMinor, detail.currency)} /><ReviewRow label="Status" value={detail.status} /><ReviewRow label="Created" value={formatTransferDate(detail.createdAt)} /></div><div className="dialog-actions">{canPayAgain(detail) && <Button onClick={() => { setDetail(null); onPayAgain(detail) }}>Pay Again</Button>}<Button onClick={() => setDetail(null)}>Close</Button></div></Dialog>}</div>
}

function AccountsPage({ accounts, loading, error, onRefresh }: { accounts: AccountBalance[]; loading: boolean; error: string; onRefresh: () => void }) {
  const { logout, user } = useAuth()
  const [profile, setProfile] = useState<BankingProfile>({
    name: '',
    phone: '',
    addressLine: '',
    city: '',
    region: '',
    postalCode: '',
    country: ''
  })
  const [phoneCountry, setPhoneCountry] = useState<CountryOption>(countries[0])
  const [phoneLocal, setPhoneLocal] = useState('')
  const [profileLoading, setProfileLoading] = useState(true)
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [profileMessage, setProfileMessage] = useState('')
  const [editingProfile, setEditingProfile] = useState(true)
  const [profileReload, setProfileReload] = useState(0)
  const profileSavingRef = useRef(false)

  useEffect(() => {
    let active = true
    api.get<{ user: { name: string; profile: BankingProfile } }>('/users/me')
      .then(({ data }) => {
        if (!active) return
        const loadedProfile = {
          name: data.user.name || '',
          phone: data.user.profile.phone || '',
          addressLine: data.user.profile.addressLine || '',
          city: data.user.profile.city || '',
          region: data.user.profile.region || '',
          postalCode: data.user.profile.postalCode || '',
          country: data.user.profile.country || ''
        }
        const selectedPhoneCountry = findPhoneCountry(loadedProfile.phone)
        setPhoneCountry(selectedPhoneCountry)
        setPhoneLocal(loadedProfile.phone.startsWith(selectedPhoneCountry.callingCode)
          ? loadedProfile.phone.slice(selectedPhoneCountry.callingCode.length)
          : loadedProfile.phone)
        const complete = isBankingProfileComplete(loadedProfile)
        setProfile(loadedProfile)
        setEditingProfile(!complete)
      })
      .catch(async (requestError) => {
        if (axios.isAxiosError(requestError) && requestError.response?.status === 401) {
          await logout()
          return
        }
        if (active) setProfileError(getDetailedApiErrorMessage(requestError, 'We could not load your banking profile.'))
      })
      .finally(() => { if (active) setProfileLoading(false) })
    return () => { active = false }
  }, [logout, profileReload])

  function updateProfile(field: keyof typeof profile, value: string) {
    setProfile((current) => ({
      ...current,
      [field]: value
    }))
    setProfileMessage('')
    setProfileError('')
  }

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (profileSavingRef.current) return
    profileSavingRef.current = true
    setProfileSaving(true)
    setProfileError('')
    setProfileMessage('')
    try {
      const normalizedLocal = phoneLocal.replace(/\D/g, '')
      if (normalizedLocal && (normalizedLocal.length < phoneCountry.minDigits || normalizedLocal.length > phoneCountry.maxDigits)) {
        setProfileError(`Enter a valid ${phoneCountry.name} phone number.`)
        return
      }
      const response = await api.patch<{ user: { name: string; profile: BankingProfile }; message: string }>('/users/me', {
        ...profile,
        phone: normalizedLocal ? `${phoneCountry.callingCode}${normalizedLocal}` : ''
      })
      const savedProfile = {
        name: response.data.user.name,
        phone: response.data.user.profile.phone || '',
        addressLine: response.data.user.profile.addressLine || '',
        city: response.data.user.profile.city || '',
        region: response.data.user.profile.region || '',
        postalCode: response.data.user.profile.postalCode || '',
        country: response.data.user.profile.country || ''
      }
      const complete = isBankingProfileComplete(savedProfile)
      setProfile(savedProfile)
      setProfileMessage(response.data.message)
      if (complete) {
        setEditingProfile(false)
        onRefresh()
      }
    } catch (requestError) {
      if (axios.isAxiosError(requestError) && requestError.response?.status === 401) {
        await logout()
        return
      }
      setProfileError(getDetailedApiErrorMessage(requestError, 'We could not save your banking profile.'))
    } finally {
      profileSavingRef.current = false
      setProfileSaving(false)
    }
  }

  return <div>
    <div className="page-heading"><div><span className="section-kicker">Authorized accounts</span><h1>Accounts</h1><p>Your INR accounts are securely linked to your signed-in identity.</p></div><Button variant="secondary" onClick={onRefresh} disabled={loading}><Activity size={15} /> {loading ? 'Refreshing…' : 'Refresh accounts'}</Button></div>
    {error && <Card className="dashboard-error"><strong>{error}</strong><Button size="sm" onClick={onRefresh}>Retry</Button></Card>}
    {profileError && <Card className="dashboard-error"><strong>{profileError}</strong><Button size="sm" onClick={() => { setProfileError(''); setProfileLoading(true); setProfileReload((attempt) => attempt + 1) }}>Retry</Button></Card>}
    {profileLoading ? <Card><PanelHeading kicker="Personal information" title="Banking profile" /><div className="table-loading"><Skeleton className="skeleton-line" /><Skeleton className="skeleton-line" /></div></Card> : <>
      <Card className="banking-profile-card">
        <PanelHeading kicker="Personal information" title="Banking profile">
          {!editingProfile && <Button size="sm" variant="secondary" onClick={() => { setEditingProfile(true); setProfileMessage('') }}>Edit profile</Button>}
        </PanelHeading>
        <p className="profile-description">Keep your contact and address details current. No password, card PIN, or government ID is requested.</p>
        {profileError && <div className="form-error" role="alert">{profileError}</div>}
        {profileMessage && <div className="profile-success" role="status">{profileMessage}</div>}
        {editingProfile ? <form className="banking-profile-form" onSubmit={(event) => void saveProfile(event)}>
          <label className="field"><span className="field-label">Full name</span><input className="ui-input" autoComplete="name" maxLength={120} required value={profile.name} onChange={(event) => updateProfile('name', event.target.value)} /></label>
          <label className="field"><span className="field-label">Phone number</span><div className="phone-input-row"><PhoneCountryPicker value={phoneCountry} onChange={setPhoneCountry} /><input className="ui-input" type="tel" autoComplete="tel-national" placeholder="Enter phone number" required value={phoneLocal} onChange={(event) => { setPhoneLocal(event.target.value); updateProfile('phone', event.target.value) }} /></div><span className="field-hint">Stored securely in international E.164 format.</span></label>
          <label className="field"><span className="field-label">Address</span><input className="ui-input" autoComplete="street-address" maxLength={240} required value={profile.addressLine} onChange={(event) => updateProfile('addressLine', event.target.value)} /></label>
          <label className="field"><span className="field-label">City</span><input className="ui-input" autoComplete="address-level2" maxLength={100} required value={profile.city} onChange={(event) => updateProfile('city', event.target.value)} /></label>
          <label className="field"><span className="field-label">State or province</span><input className="ui-input" autoComplete="address-level1" maxLength={100} required value={profile.region} onChange={(event) => updateProfile('region', event.target.value)} /></label>
          <label className="field"><span className="field-label">Postal code</span><input className="ui-input" autoComplete="postal-code" maxLength={20} required value={profile.postalCode} onChange={(event) => updateProfile('postalCode', event.target.value)} /></label>
          <div className="field"><span className="field-label">Country of residence</span><ResidenceCountryPicker value={countries.find((country) => country.code === profile.country) || countries[0]} onChange={(country) => updateProfile('country', country.code)} /></div>
          <div className="profile-form-actions"><Button type="submit" disabled={profileSaving}>{profileSaving ? 'Saving profile…' : 'Save banking profile'}</Button></div>
        </form> : <dl className="profile-summary">
          <div><dt>Full name</dt><dd>{profile.name}</dd></div>
          {profile.phone && <div><dt>Phone</dt><dd>{profile.phone}</dd></div>}
          <div><dt>Address</dt><dd>{profile.addressLine}</dd></div>
          <div><dt>City</dt><dd>{profile.city}</dd></div>
          <div><dt>State / province</dt><dd>{profile.region}</dd></div>
          <div><dt>Postal code</dt><dd>{profile.postalCode}</dd></div>
          <div><dt>Country</dt><dd>{countries.find((country) => country.code === profile.country)?.name || profile.country}</dd></div>
        </dl>}
        <EmailVerification key={user?.email || ''} email={user?.email || ''} disabled={profileSaving} onVerificationChange={(verified) => { if (verified) onRefresh() }} />
      </Card>
      <div className="account-page-grid">
        <Card><PanelHeading kicker="Your accounts" title="Available INR balances"><Badge tone={accounts.length ? 'success' : 'neutral'}>{accounts.length} connected</Badge></PanelHeading>{loading ? <div className="table-loading"><Skeleton className="skeleton-line" /><Skeleton className="skeleton-line" /></div> : accounts.length ? <div className="account-list">{accounts.map((account) => <div className="account-row" key={account.id}><div className="account-icon"><WalletCards size={17} /></div><div className="account-info"><strong>{account.holderName || user?.name || 'Account holder'}</strong><span>{account.accountNumber} · {account.status.toLowerCase()} · INR</span></div><div className="account-balance"><strong>{formatMoney(account.balanceMinor, 'INR')}</strong><span>Available INR ledger balance</span></div></div>)}</div> : <EmptyState title="No INR accounts available" message="Complete your profile and verify your email to receive an INR account." />}</Card>
      </div>
    </>}
  </div>
}

function SettingsPage() {
  const [dark, setDark] = useState(() => localStorage.getItem('ledgerguard-theme') !== 'light')
  const [soundEnabled, setSoundEnabled] = useState(isSuccessSoundEnabled)
  function toggle() { const next = !dark; setDark(next); localStorage.setItem('ledgerguard-theme', next ? 'dark' : 'light'); document.querySelector('.app-shell')?.classList.toggle('dark', next); document.querySelector('.app-shell')?.classList.toggle('light', !next) }
  function toggleSound() {
    const next = !soundEnabled
    setSoundEnabled(next)
    setSuccessSoundEnabled(next)
    window.dispatchEvent(new Event('ledgerguard-sound-preference'))
  }
  return <div>
    <div className="page-heading"><div><span className="section-kicker">Account settings</span><h1>Settings</h1><p>Manage local display preferences for this device.</p></div></div>
    <Card><PanelHeading kicker="Appearance" title="Theme" /><div className="setting-row"><div><strong>{dark ? 'Dark' : 'Light'} theme</strong><span>Stored locally on this device; it does not affect account data.</span></div><Button variant="secondary" onClick={toggle}>{dark ? 'Use light theme' : 'Use dark theme'}</Button></div><div className="setting-row"><div><strong>Transaction success sound</strong><span>Play a brief sound only after a transfer is confirmed as completed.</span></div><Button variant="secondary" onClick={toggleSound}>{soundEnabled ? 'Mute sound' : 'Enable sound'}</Button></div></Card>
  </div>
}

function HelpPage() {
  const contacts = [
    { label: 'LinkedIn', value: publicContact.linkedin, href: publicContact.linkedin, icon: Linkedin, action: 'Visit profile' },
    { label: 'Email', value: publicContact.email, href: publicContact.email ? `mailto:${publicContact.email}` : '', icon: Mail, action: 'Send email' },
    { label: 'GitHub', value: publicContact.github, href: publicContact.github, icon: Github, action: 'Visit profile' },
    { label: 'Twitter / X', value: publicContact.twitter, href: publicContact.twitter, icon: Twitter, action: 'Visit profile' },
    { label: 'Instagram', value: publicContact.instagram, href: publicContact.instagram, icon: Instagram, action: 'Visit profile' },
    { label: 'Phone', value: publicContact.phone, href: publicContact.phone ? `tel:${publicContact.phone}` : '', icon: Phone, action: 'Call' }
  ]
  return <div><div className="page-heading"><div><span className="section-kicker">Support</span><h1>Help center</h1><p>Useful guidance and contact options for the current LedgerGuard workflow.</p></div></div><Card><PanelHeading kicker="Safe operation" title="Transfers and balances" /><div className="help-list"><p><strong>Balances:</strong> values are read from the authorized ledger API and are never calculated in the browser.</p><p><strong>Transfers:</strong> requests use an idempotency key. If a request times out, check status before retrying the same request.</p><p><strong>Authentication:</strong> sessions are held in memory and expire when the page is refreshed.</p></div></Card><Card className="help-contact-card"><PanelHeading kicker="Personal support" title="Get in touch" /><p className="page-copy">Contact details are shown only when configured for public display.</p><div className="contact-grid">{contacts.map(({ label, value, href, icon: Icon, action }) => <div className="contact-card" key={label}><span className="contact-icon"><Icon size={18} aria-hidden="true" /></span><div className="contact-info"><strong>{label}</strong>{value ? <span>{value}</span> : <span className="contact-placeholder">Not configured</span>}</div>{href ? <a className="contact-action" href={href} aria-label={`${action}: ${label}`} {...(href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{action}{href.startsWith('http') && <ExternalLink size={13} aria-hidden="true" />}</a> : <span className="contact-action contact-disabled" aria-disabled="true">Add details</span>}</div>)}</div></Card></div>
}

function TransferDialog({ open, accounts, initialTransfer, onClose, onCompleted }: { open: boolean; accounts: AccountBalance[]; initialTransfer: TransferHistory | null; onClose: () => void; onCompleted: () => void }) {
  const [step, setStep] = useState<'form' | 'review' | 'result'>('form')
  const [receiverId, setReceiverId] = useState('')
  const [recipient, setRecipient] = useState<{ accountId: string; accountNumber: string; holderName: string; status: string; currency: string; eligible: boolean } | null>(null)
  const [recipientLoading, setRecipientLoading] = useState(false)
  const [recipientError, setRecipientError] = useState('')
  const [amount, setAmount] = useState('')
  const [formError, setFormError] = useState('')
  const [result, setResult] = useState<TransferResult | null>(null)
  const [resultMessage, setResultMessage] = useState('')
  const [failedAttempt, setFailedAttempt] = useState<{
    id: string
    amountMinor: string
    currency: string
    sourceAccount: string
    availableBalanceMinor: string
    requiredAmountMinor: string
  } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [idempotencyKey, setIdempotencyKey] = useState('')
  const [statusChecking, setStatusChecking] = useState(false)
  const submissionInFlight = useRef(false)
  const statusCheckInFlight = useRef(false)
  const pollingTimer = useRef<number | undefined>(undefined)

  const sender = accounts[0]
  useEffect(() => {
    if (!open || !initialTransfer || !canPayAgain(initialTransfer)) return
    setStep('form')
    setReceiverId(initialTransfer.receiverAccountNumber || '')
    setAmount(amountInputFromMinor(initialTransfer.amountMinor))
    setRecipient(null)
    setRecipientError('')
    setFormError('')
    setResult(null)
    setResultMessage('')
    setFailedAttempt(null)
    setUncertain(false)
    setIdempotencyKey('')
  }, [initialTransfer, open])
  const reset = () => {
    setStep('form')
    setReceiverId('')
    setRecipient(null)
    setRecipientLoading(false)
    setRecipientError('')
    setAmount('')
    setFormError('')
    setResult(null)
    setResultMessage('')
    setFailedAttempt(null)
    setSubmitting(false)
    setUncertain(false)
    setIdempotencyKey('')
    setStatusChecking(false)
  }
  const close = () => { if (!submitting) { reset(); onClose() } }
  useEffect(() => {
    const accountId = receiverId.trim()
    setRecipient(null)
    setRecipientError('')
    if (!accountId) return
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setRecipientLoading(true)
      try {
        const response = await api.get<{ recipient: NonNullable<typeof recipient> }>(`/accounts/recipient/${encodeURIComponent(accountId)}`, { signal: controller.signal })
        if (!controller.signal.aborted) setRecipient(response.data.recipient)
      } catch (requestError) {
        if (!controller.signal.aborted) setRecipientError(axios.isAxiosError(requestError) && requestError.response?.status === 404 ? 'Recipient account was not found.' : getApiErrorMessage(requestError, 'We could not verify this recipient account.'))
      } finally {
        if (!controller.signal.aborted) setRecipientLoading(false)
      }
    }, 350)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [receiverId])
  const review = () => {
    const minor = toMinorUnits(amount)
    if (!sender) return setFormError('An active account is required to start a transfer.')
    if (sender.status !== 'ACTIVE') return setFormError('The sender account is not active.')
    if (!receiverId.trim()) return setFormError('Enter a recipient account number.')
    if (receiverId.trim() === sender.accountNumber) return setFormError('Sender and recipient accounts must be different.')
    if (!recipient) return setFormError(recipientLoading ? 'Wait while the recipient account is verified.' : 'Verify a valid recipient account before continuing.')
    if (!recipient.eligible) return setFormError('This recipient account is not eligible to receive INR transfers.')
    if (!minor) return setFormError('Enter an amount greater than zero with up to two decimal places.')
    setFormError('')
    setStep('review')
  }
  const submit = async () => {
    const minor = toMinorUnits(amount)
    if (!minor || !sender || submissionInFlight.current || statusCheckInFlight.current) return
    submissionInFlight.current = true
    const key = idempotencyKey || crypto.randomUUID()
    setIdempotencyKey(key)
    setSubmitting(true)
    setFormError('')
    setUncertain(false)
    setFailedAttempt(null)
    try {
      const response = await api.post<{ transfer: TransferResult; replayed: boolean }>('/transaction', {
        receiverAccountId: receiverId.trim(),
        amountMinor: minor,
        currency: sender.currency
      }, { headers: { 'Idempotency-Key': key }, timeout: 15000 })
      setResult(response.data.transfer)
      setResultMessage(response.data.replayed ? 'This request was safely replayed using the same idempotency key.' : response.status === 202 ? 'The transfer was accepted for risk review.' : 'The transfer was completed atomically.')
      setStep('result')
      setUncertain(false)
      if (response.data.transfer.status === 'COMPLETED') onCompleted()
    } catch (requestError) {
      if (axios.isAxiosError(requestError) &&
        (requestError.code === 'ECONNABORTED' || requestError.code === 'ETIMEDOUT' || !requestError.response)) {
        setUncertain(true)
        setResultMessage('The request timed out. The outcome is uncertain; retry only with the same request key.')
      } else {
        if (axios.isAxiosError<{ error?: { code?: string; details?: { availableBalanceMinor?: string; requiredAmountMinor?: string; currency?: string } } }>(requestError) &&
          requestError.response?.data?.error?.code === 'INSUFFICIENT_FUNDS') {
          const details = requestError.response.data.error.details
          if (details?.availableBalanceMinor && details.requiredAmountMinor) {
            setFailedAttempt({
              id: `failed:${key}`,
              amountMinor: details.requiredAmountMinor,
              currency: details.currency || sender.currency,
              sourceAccount: sender.accountNumber,
              availableBalanceMinor: details.availableBalanceMinor,
              requiredAmountMinor: details.requiredAmountMinor
            })
          } else {
            setFormError('The transfer was rejected because the available balance was insufficient.')
          }
        } else {
          setFormError(getApiErrorMessage(requestError, 'The transfer could not be submitted.'))
        }
      }
    } finally {
      submissionInFlight.current = false
      setSubmitting(false)
    }
  }
  const checkStatus = async () => {
    if (!idempotencyKey || !sender || statusCheckInFlight.current || submissionInFlight.current) return null
    statusCheckInFlight.current = true
    setStatusChecking(true)
    setFormError('')
    try {
      const response = await api.get<{ transfer: TransferResult }>('/transaction/status', {
        headers: { 'Idempotency-Key': idempotencyKey }
      })
      setResult(response.data.transfer)
      setResultMessage('The backend confirmed this transfer status.')
      setStep('result')
      setUncertain(false)
      if (response.data.transfer.status === 'COMPLETED') onCompleted()
      return response.data.transfer
    } catch (requestError) {
      if (axios.isAxiosError(requestError) && requestError.response?.status === 404) {
        setResultMessage('No transfer is recorded for this request key yet. If you retry, the original key will be reused safely.')
      } else {
        setFormError(getApiErrorMessage(requestError, 'We could not check this transfer yet.'))
      }
    } finally {
      statusCheckInFlight.current = false
      setStatusChecking(false)
    }
    return null
  }
  const payAgain = async () => {
    let latest = result
    if (failedAttempt) {
      latest = await checkStatus()
      if (!latest || latest.status !== 'FAILED') {
        setResultMessage('Pay Again is unavailable until the original transfer is confirmed as failed by the server.')
        return
      }
    } else if (latest && latest.status !== 'COMPLETED' && latest.status !== 'FAILED') {
      latest = await checkStatus()
      if (!latest || (latest.status !== 'COMPLETED' && latest.status !== 'FAILED')) {
        setResultMessage('Pay Again is unavailable until the original transfer reaches a definitive completed or failed status.')
        return
      }
    }
    const receiverAccountNumber = latest?.receiverAccountNumber || recipient?.accountNumber
    if (!receiverAccountNumber) {
      setFormError('The original recipient account could not be verified.')
      return
    }
    setStep('form')
    setReceiverId(receiverAccountNumber)
    setAmount(amountInputFromMinor(latest?.amountMinor || failedAttempt?.requiredAmountMinor || amount))
    setResult(null)
    setFailedAttempt(null)
    setResultMessage('')
    setFormError('')
    setUncertain(false)
    setIdempotencyKey('')
  }
  useEffect(() => {
    if (step !== 'result' || !result || result.status === 'COMPLETED' || !idempotencyKey) return
    let attempts = 0
    const poll = () => {
      if (attempts >= 8 || statusCheckInFlight.current || submissionInFlight.current) return
      attempts += 1
      void checkStatus()
      pollingTimer.current = window.setTimeout(poll, 4000)
    }
    pollingTimer.current = window.setTimeout(poll, 4000)
    return () => { if (pollingTimer.current) window.clearTimeout(pollingTimer.current) }
  }, [step, result, idempotencyKey])
  return <>
  <Dialog open={open && step !== 'result'} title={step === 'review' ? 'Review transfer' : 'New transfer'} onClose={close}>
    {step === 'form' && <form className="transfer-form" onSubmit={(event) => { event.preventDefault(); review() }}>
      <p className="transfer-intro">{initialTransfer ? `Pay Again from ${formatTransferDate(initialTransfer.createdAt)} · Original amount ${formatMoney(initialTransfer.amountMinor, initialTransfer.currency)}. Edit the amount before reviewing.` : 'Transfers are checked and committed by the LedgerGuard API. Review every detail before submitting.'}</p>
      {sender && <div className="review-list"><ReviewRow label="From account" value={`${sender.currency} account · ${sender.accountNumber}`} /></div>}
      <label className="field"><span className="field-label">Recipient account number</span><input className="ui-input" value={receiverId} onChange={(event) => setReceiverId(event.target.value)} placeholder="Paste the recipient account number" autoComplete="off" /></label>
      {recipientLoading && <div className="admin-secondary" role="status">Verifying recipient account…</div>}
      {recipientError && <div className="form-error" role="alert">{recipientError}</div>}
      {recipient && <div className="review-list"><ReviewRow label="Recipient" value={recipient.holderName} /><ReviewRow label="Account number" value={recipient.accountNumber} /><ReviewRow label="Status" value={recipient.eligible ? 'Eligible to receive INR' : `${recipient.status} · Not eligible`} /></div>}
      <label className="field"><span className="field-label">Amount {sender && `(${sender.currency})`}</span><input className="ui-input" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" inputMode="decimal" /></label>
      {formError && <div className="form-error" role="alert">{formError}</div>}
      <div className="dialog-actions"><Button type="button" variant="ghost" onClick={close}>Cancel</Button><Button type="submit" disabled={submitting}>Review transfer</Button></div>
    </form>}
    {step === 'review' && sender && recipient && <div className="transfer-form"><p className="transfer-intro">Confirm the recipient and amount. The backend will perform the authoritative ownership, balance, currency, and risk checks.</p><div className="review-list"><ReviewRow label="From" value={`${sender.currency} account · ${sender.accountNumber}`} /><ReviewRow label="Recipient" value={recipient.holderName} /><ReviewRow label="Account number" value={recipient.accountNumber} /><ReviewRow label="Eligibility" value={recipient.eligible ? 'Eligible to receive INR' : 'Not eligible'} /><ReviewRow label="Amount" value={formatMoney(toMinorUnits(amount) || '0', sender.currency)} /><ReviewRow label="Processing" value="Atomic ledger transfer" /></div>{formError && <div className="form-error" role="alert">{formError}</div>}<div className="dialog-actions"><Button type="button" variant="ghost" onClick={() => setStep('form')}>Edit</Button><Button type="button" onClick={() => void submit()} disabled={submitting || !recipient.eligible}>{submitting ? 'Submitting securely…' : 'Confirm transfer'}</Button></div></div>}
    {uncertain && <div className="transfer-uncertain" role="alert"><strong>Outcome uncertain</strong><p>{resultMessage}</p>{formError && <div className="form-error" role="alert">{formError}</div>}<div className="dialog-actions"><Button size="sm" variant="secondary" onClick={() => void checkStatus()} disabled={statusChecking || submitting}>{statusChecking ? 'Checking…' : 'Check transfer status'}</Button><Button size="sm" onClick={() => void submit()} disabled={submitting || statusChecking}>{submitting ? 'Retrying…' : 'Retry same request safely'}</Button></div></div>}
  </Dialog>
  {open && ((step === 'result' && result) || failedAttempt) && <TransactionResultModal transaction={result || undefined} failureAttempt={failedAttempt || undefined} recipientName={recipient?.holderName} recipientAccount={recipient?.accountNumber} message={resultMessage} onClose={close} onRetry={() => { setFailedAttempt(null); setStep('form'); setResult(null); setFormError('') }} onCheckStatus={() => void checkStatus()} onPayAgain={payAgain} checking={statusChecking} />}
  </>
}

function ReviewRow({ label, value }: { label: string; value: string }) { return <div className="review-row"><span>{label}</span><strong>{value}</strong></div> }

function RiskPanel({ loading, error, permission, transfers, filter, onFilter, onRetry, onDecided }: { loading: boolean; error: string; permission: 'unknown' | 'allowed' | 'denied'; transfers: FlaggedTransfer[]; filter: string; onFilter: (value: string) => void; onRetry: () => void; onDecided: () => void }) {
  const [selected, setSelected] = useState<FlaggedTransfer | null>(null)
  const [decision, setDecision] = useState<'APPROVE' | 'DECLINE' | null>(null)
  const [notes, setNotes] = useState('')
  const [actionError, setActionError] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const confirmDecision = async () => {
    if (!selected || !decision) return
    setActionLoading(true)
    setActionError('')
    try {
      await api.post(`/admin/transfers/${selected.id}/decision`, { decision, notes })
      setSelected(null)
      setDecision(null)
      setNotes('')
      onDecided()
    } catch (requestError) {
      setActionError(getApiErrorMessage(requestError, 'The review action could not be completed.'))
    } finally {
      setActionLoading(false)
    }
  }
  return <><Card className="risk-panel" id="risk"><PanelHeading kicker="Control center" title="Risk review"><Badge tone={permission === 'denied' ? 'neutral' : transfers.length ? 'warning' : 'success'}>{permission === 'denied' ? 'Admin only' : `${transfers.length} flagged`}</Badge></PanelHeading>{permission === 'denied' && <EmptyState title="Administrator access required" message="Risk assessments and review actions are restricted by the backend to the configured administrator." />}{permission !== 'denied' && <><div className="risk-toolbar"><span>Risk scores indicate configured signals, not proof of fraud.</span><select className="ui-input" value={filter} onChange={(event) => onFilter(event.target.value)}><option value="">All flagged transfers</option><option value="REVIEW">Awaiting review</option></select><Button size="sm" variant="ghost" onClick={onRetry}>Refresh</Button></div>{error && <div className="form-error" role="alert">{error} <button className="text-button" onClick={onRetry}>Retry</button></div>}{loading ? <div className="table-loading"><Skeleton className="skeleton-line" /><Skeleton className="skeleton-line" /></div> : transfers.length ? <div className="risk-list">{transfers.map((transfer) => <button className="risk-row" key={transfer.id} onClick={() => { setSelected(transfer); setActionError('') }}><span className={`risk-score ${transfer.risk.level.toLowerCase()}`}>{transfer.risk.score}</span><span className="history-main"><strong>{formatMoney(transfer.amountMinor, transfer.currency)} transfer</strong><small>{transfer.id.slice(0, 12)}… · {transfer.risk.reasons.join(' ')}</small></span><Badge tone={transfer.risk.level === 'HIGH' ? 'danger' : transfer.risk.level === 'MEDIUM' ? 'warning' : 'success'}>{transfer.risk.level} · {transfer.risk.decision}</Badge></button>)}</div> : <EmptyState title="No flagged transfers" message="No transfers are currently returned by the admin risk queue." />}</>}</Card>{selected && <Dialog open title="Risk assessment" onClose={() => setSelected(null)}><div className="risk-detail"><div className={`risk-score large ${selected.risk.level.toLowerCase()}`}>{selected.risk.score}</div><strong>{selected.risk.level} risk · {selected.risk.decision}</strong><p>Configured risk signals are informational and do not establish fraud.</p><div className="review-list">  <ReviewRow label="Transfer" value={selected.id} /><ReviewRow label="Funding To / Recipient Account" value={selected.receiverAccountNumber || 'Unavailable'} /><ReviewRow label="Amount" value={formatMoney(selected.amountMinor, selected.currency)} /><ReviewRow label="Status" value={selected.status} /></div><ul className="risk-reasons">{selected.risk.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>{selected.risk.decision === 'REVIEW' && <><label className="field"><span className="field-label">Review notes (optional)</span><textarea className="ui-input" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} /></label>{actionError && <div className="form-error">{actionError}</div>}<div className="dialog-actions"><Button variant="danger" onClick={() => setDecision('DECLINE')}>Decline</Button><Button onClick={() => setDecision('APPROVE')}>Approve</Button></div>{decision && <div className="confirm-box"><p>Confirm {decision.toLowerCase()} this transfer?</p><div className="dialog-actions"><Button variant="ghost" onClick={() => setDecision(null)}>Cancel</Button><Button onClick={() => void confirmDecision()} disabled={actionLoading}>{actionLoading ? 'Saving…' : `Confirm ${decision.toLowerCase()}`}</Button></div></div>}</>}</div></Dialog>}</>
}

function EmptyState({ title, message }: { title: string; message: string }) { return <div className="empty-state"><div className="empty-icon"><Activity size={18} /></div><strong>{title}</strong><p>{message}</p></div> }
function PanelHeading({ kicker, title, children }: { kicker: string; title: string; children?: ReactNode }) { return <div className="panel-heading"><div><span className="section-kicker">{kicker}</span><h2>{title}</h2></div>{children}</div> }
function SummaryCard({ label, value, detail, icon, tone, loading = false }: { label: string; value: string; detail: string; icon: ReactNode; tone: string; loading?: boolean }) { return <motion.div className="stat-card" variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0, transition: { duration: .28, ease: [0.22, 1, 0.36, 1] } } }} whileHover={{ y: -3 }} whileTap={{ scale: .99 }}><div className={`stat-icon ${tone}`}>{icon}</div><span className="stat-label">{label}</span>{loading ? <Skeleton className="summary-skeleton" /> : <strong className="stat-value">{value}</strong>}<span className="stat-change">{detail}</span></motion.div> }

function PageTransition({ routeKey, reducedMotion, children }: { routeKey: string; reducedMotion: boolean | null; children: ReactNode }) {
  const initial = reducedMotion ? false : { y: 32 }

  return <motion.div
    key={routeKey}
    className="page-transition"
    initial={initial}
    animate={reducedMotion ? undefined : { y: 0 }}
    transition={{ duration: .5, ease: [0.22, 1, 0.36, 1] }}
  >
    {children}
  </motion.div>
}

function AppContent() {
  const { user, sessionStatus, retrySession, logout } = useAuth()
  const location = useLocation()
  if (sessionStatus === 'restoring') return <SessionGate loading />
  if (sessionStatus === 'error') return <SessionGate onRetry={() => void retrySession()} onSignOut={() => void logout()} />
  return <LoginTransition active={!user && location.pathname !== '/verify-email'}>
    <Routes>
    <Route path="/verify-email" element={<VerifyEmailPage />} />
    <Route path="/forgot-password" element={<ForgotPasswordPage />} />
    <Route path="/reset-password" element={<ResetPasswordPage />} />
    <Route path="/admin/*" element={user ? <AdminPortal /> : <AuthPage />} />
    <Route path="*" element={user ? <Dashboard /> : <AuthPage />} />
    </Routes>
  </LoginTransition>
}

function LoginTransition({ active, children }: { active: boolean; children: ReactNode }) {
  const reducedMotion = useReducedMotion()
  const [introVisible, setIntroVisible] = useState(active)

  useEffect(() => {
    if (!active || reducedMotion) {
      setIntroVisible(false)
      return
    }
    setIntroVisible(true)
    const timer = window.setTimeout(() => {
      setIntroVisible(false)
    }, 1960)
    return () => window.clearTimeout(timer)
  }, [active, reducedMotion])

  return <div className={`login-transition-shell${introVisible ? ' login-intro-active' : ''}`}>
    <div className={`login-transition-content${active && !introVisible ? ' login-intro-complete' : ''}`}>{children}</div>
    {introVisible && <div className="login-intro" aria-hidden="true">
      <div className="login-intro-brand">
        <div className="login-intro-mark"><ShieldCheck size={52} strokeWidth={1.6} /></div>
        <div className="login-intro-wordmark">Ledger<span>Guard</span></div>
      </div>
      <div className="login-intro-wipe" />
    </div>}
  </div>
}

function SessionGate({ loading = false, onRetry, onSignOut }: { loading?: boolean; onRetry?: () => void; onSignOut?: () => void }) {
  return <main className="session-gate">
    <section className="session-gate-card" role={loading ? 'status' : 'alert'}>
      <div className="brand-mark"><ShieldCheck size={18} /></div>
      <h1>{loading ? 'Restoring your session' : 'Session temporarily unavailable'}</h1>
      <p>{loading ? 'Verifying your secure LedgerGuard session…' : 'We could not verify your session right now. Your sign-in is preserved; try again shortly.'}</p>
      {loading ? <span className="spinner" aria-label="Loading" /> : <div className="session-gate-actions">
        <Button onClick={onRetry}>Retry</Button>
        <Button variant="ghost" onClick={onSignOut}>Return to sign in</Button>
      </div>}
    </section>
  </main>
}

function MotionRuntime({ children }: { children: ReactNode }) {
  const reducedMotion = useReducedMotion()
  useLayoutEffect(() => {
    if (reducedMotion) return
    const lenis = new Lenis({ autoRaf: false, prevent: (node) => Boolean(node.closest('[data-lenis-prevent]')) })
    const ticker = (time: number) => { lenis.raf(time * 1000) }
    gsap.ticker.add(ticker)
    return () => { gsap.ticker.remove(ticker); lenis.destroy() }
  }, [reducedMotion])
  return <>{children}</>
}

function App() { return <BrowserRouter><AuthProvider><MotionRuntime><AppContent /></MotionRuntime></AuthProvider></BrowserRouter> }

export default App
