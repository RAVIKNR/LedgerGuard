import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type FocusEvent } from 'react'
import axios from 'axios'
import { api, getApiErrorMessage } from '../lib/api'
import { useAuth } from '../auth/AuthContext'
import { Badge, Button, Card, Dialog, Table } from './ui'

type Pagination = { page: number; pageSize: number; total: number; totalPages: number }
type UserRow = {
  id: string
  name: string
  email: string
  status: string
  emailVerifiedAt: string | null
  createdAt: string
}
type AccountRow = {
  id: string
  userId: string
  currency: string
  accountNumber: string
  status: string
  createdAt: string
  user: { name: string; email: string }
  balanceMinor: string
  eligibleForFinancialOperations: boolean
}
type RecipientRow = { accountId: string; accountNumber: string; holderName: string }
function maskAccountNumber(accountNumber: string) {
  return `•••• ${accountNumber.slice(-8)}`
}

function RecipientCombobox({ selected, onSelect, onClear }: {
  selected: RecipientRow | null
  onSelect: (recipient: RecipientRow) => void
  onClear: () => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [recipients, setRecipients] = useState<RecipientRow[]>([])
  const [activeIndex, setActiveIndex] = useState(-1)
  const [retryToken, setRetryToken] = useState(0)
  const requestRef = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const comboboxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(async () => {
      requestRef.current?.abort()
      const controller = new AbortController()
      requestRef.current = controller
      setLoading(true)
      setError('')
      try {
        const response = await api.get<{ accounts: RecipientRow[] }>('/admin/accounts/recipients', {
          params: { page: 1, pageSize: 50, ...(query.trim() ? { search: query.trim() } : {}) },
          signal: controller.signal
        })
        if (!controller.signal.aborted) {
          setRecipients(response.data.accounts)
          setActiveIndex(-1)
        }
      } catch (requestError) {
        if (!controller.signal.aborted) setError(getApiErrorMessage(requestError, 'Could not load eligible recipient accounts.'))
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, 250)
    return () => {
      window.clearTimeout(timer)
      requestRef.current?.abort()
    }
  }, [open, query, retryToken])

  function selectRecipient(recipient: RecipientRow) {
    onSelect(recipient)
    setOpen(false)
    setQuery('')
    inputRef.current?.blur()
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (!comboboxRef.current?.contains(event.relatedTarget as Node | null)) {
      setOpen(false)
      setQuery('')
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActiveIndex((index) => Math.min(index + 1, recipients.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter' && open && activeIndex >= 0) {
      event.preventDefault()
      selectRecipient(recipients[activeIndex])
    } else if (event.key === 'Escape') {
      setOpen(false)
      inputRef.current?.blur()
    }
  }

  const label = selected ? `${selected.holderName} · ${maskAccountNumber(selected.accountNumber)}` : ''
  return <div ref={comboboxRef} className="recipient-combobox" onBlur={handleBlur}>
    <div className="recipient-combobox-input">
      <input
        ref={inputRef}
        className="ui-input"
        role="combobox"
        aria-label="Search recipient accounts"
        aria-expanded={open}
        aria-controls="recipient-options"
        aria-autocomplete="list"
        placeholder="Search by holder name or account number"
        value={open ? query : label}
        onFocus={() => { setOpen(true); if (selected) setQuery('') }}
        onChange={(event) => { setQuery(event.target.value); setOpen(true) }}
        onKeyDown={handleKeyDown}
      />
      {selected && <button type="button" className="text-button" onClick={() => { onClear(); setQuery(''); setOpen(true); inputRef.current?.focus() }}>Clear</button>}
    </div>
    {open && <div id="recipient-options" className="recipient-combobox-options" role="listbox">
      {loading && <div className="admin-secondary" role="status">Loading eligible recipients…</div>}
      {!loading && error && <div className="form-error" role="alert">{error} <button type="button" className="text-button" onClick={() => setRetryToken((value) => value + 1)}>Retry</button></div>}
      {!loading && !error && !recipients.length && <div className="admin-secondary">No eligible recipients found.</div>}
      {!loading && !error && recipients.map((recipient, index) => <button
        type="button"
        role="option"
        aria-selected={selected?.accountId === recipient.accountId}
        className={`recipient-option ${activeIndex === index ? 'active' : ''}`}
        key={recipient.accountId}
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => selectRecipient(recipient)}
      >
        <strong>{recipient.holderName}</strong>
        <span>{maskAccountNumber(recipient.accountNumber)}</span>
      </button>)}
    </div>}
  </div>
}
type AuditEvent = {
  id: string
  actorId: string
  actor: { id: string; name: string; email: string }
  action: string
  targetType: string
  targetId: string
  reason: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
}
type MonitoredTransfer = {
  id: string
  senderAccountId: string | null
  receiverAccountId: string
  senderAccountNumber: string | null
  receiverAccountNumber: string | null
  amountMinor: string
  currency: string
  status: string
  createdAt: string
  risk: { score: number; level: string; decision: string; reasons: unknown } | null
}
type AdminOperationsProps = { refreshKey?: number }

function useAdminRequestError() {
  const { logout } = useAuth()
  return useCallback(async (error: unknown, fallback: string) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      await logout()
      return 'Your session has expired. Sign in again.'
    }
    return getApiErrorMessage(error, fallback)
  }, [logout])
}

function Pager({ pagination, onPage }: { pagination: Pagination; onPage: (page: number) => void }) {
  return <div className="admin-pagination">
    <span>{pagination.total} records · Page {pagination.page} of {Math.max(1, pagination.totalPages)}</span>
    <div className="dialog-actions">
      <Button size="sm" variant="secondary" disabled={pagination.page <= 1} onClick={() => onPage(pagination.page - 1)}>Previous</Button>
      <Button size="sm" variant="secondary" disabled={pagination.page >= pagination.totalPages} onClick={() => onPage(pagination.page + 1)}>Next</Button>
    </div>
  </div>
}

function ActionDialog({
  title,
  target,
  saving,
  error,
  onClose,
  onConfirm
}: {
  title: string
  target: string
  saving: boolean
  error: string
  onClose: () => void
  onConfirm: (reason: string) => void
}) {
  const [reason, setReason] = useState('')
  return <Dialog open title={title} portal onClose={() => !saving && onClose()}>
    <div className="admin-action-dialog">
      <p>Target: <code>{target}</code></p>
      <label className="field">
        <span className="field-label">Reason (required)</span>
        <textarea className="ui-input" maxLength={1000} required value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="dialog-actions">
        <Button variant="ghost" disabled={saving} onClick={onClose}>Cancel</Button>
        <Button disabled={saving || !reason.trim()} onClick={() => onConfirm(reason.trim())}>{saving ? 'Saving…' : 'Confirm action'}</Button>
      </div>
    </div>
  </Dialog>
}

export function AdminUsersPage({ refreshKey = 0 }: AdminOperationsProps) {
  const getError = useAdminRequestError()
  const [rows, setRows] = useState<UserRow[]>([])
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 20, total: 0, totalPages: 0 })
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [appliedStatus, setAppliedStatus] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<UserRow | null>(null)
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const response = await api.get<{ users: UserRow[]; pagination: Pagination }>('/admin/users', {
        params: { page, pageSize: 20, ...(appliedSearch ? { search: appliedSearch } : {}), ...(appliedStatus ? { status: appliedStatus } : {}) }
      })
      setRows(response.data.users); setPagination(response.data.pagination)
    } catch (requestError) {
      setError(await getError(requestError, 'Could not load users.'))
    } finally { setLoading(false) }
  }, [appliedSearch, appliedStatus, getError, page, refreshKey])
  useEffect(() => { void load() }, [load])

  async function changeStatus(reason: string) {
    if (!selected) return
    const nextStatus = selected.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'
    setSaving(true); setActionError('')
    try {
      await api.patch(`/admin/users/${selected.id}/status`, { status: nextStatus, reason })
      setSelected(null)
      await load()
    } catch (requestError) { setActionError(await getError(requestError, 'Could not update user status.')) }
    finally { setSaving(false) }
  }

  return <Card>
    <div className="page-heading"><div><span className="section-kicker">Admin operations</span><h1>User management</h1><p>Search accounts and suspend or reactivate users. Actions require a reason and are audited.</p></div><Button variant="secondary" onClick={() => void load()} disabled={loading}>Refresh</Button></div>
    <form className="admin-filter-bar" onSubmit={(event) => { event.preventDefault(); setPage(1); setAppliedSearch(search.trim()); setAppliedStatus(status) }}>
      <input className="ui-input" aria-label="Search users" placeholder="Name, email, or user ID" maxLength={120} value={search} onChange={(event) => setSearch(event.target.value)} />
      <select className="ui-input" aria-label="Filter users by status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option><option>ACTIVE</option><option>SUSPENDED</option><option>CLOSED</option></select>
      <Button type="submit" size="sm">Apply filters</Button>
    </form>
    {error && <div className="form-error" role="alert">{error}</div>}
    {loading ? <p className="page-copy">Loading users…</p> : <Table headers={['User', 'Status', 'Email verified', 'Created', 'Action']} rows={rows.map(user => [
      <span><strong>{user.name}</strong><small className="admin-secondary">{user.email}</small></span>,
      <Badge tone={user.status === 'ACTIVE' ? 'success' : user.status === 'SUSPENDED' ? 'warning' : 'neutral'}>{user.status}</Badge>,
      user.emailVerifiedAt ? new Date(user.emailVerifiedAt).toLocaleDateString() : 'No',
      new Date(user.createdAt).toLocaleString(),
      user.status !== 'CLOSED' ? <Button size="sm" variant={user.status === 'ACTIVE' ? 'danger' : 'secondary'} onClick={() => { setSelected(user); setActionError('') }}>{user.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}</Button> : '—'
    ])} />}
    <Pager pagination={pagination} onPage={setPage} />
    {selected && <ActionDialog title={selected.status === 'ACTIVE' ? 'Suspend user' : 'Reactivate user'} target={selected.email} saving={saving} error={actionError} onClose={() => setSelected(null)} onConfirm={(reason) => void changeStatus(reason)} />}
  </Card>
}

export function AdminAccountsPage({ refreshKey = 0 }: AdminOperationsProps) {
  const getError = useAdminRequestError()
  const [rows, setRows] = useState<AccountRow[]>([])
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 20, total: 0, totalPages: 0 })
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [appliedStatus, setAppliedStatus] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<AccountRow | null>(null)
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const response = await api.get<{ accounts: AccountRow[]; pagination: Pagination }>('/admin/accounts', {
        params: { page, pageSize: 20, ...(appliedSearch ? { search: appliedSearch } : {}), ...(appliedStatus ? { status: appliedStatus } : {}) }
      })
      setRows(response.data.accounts); setPagination(response.data.pagination)
    } catch (requestError) { setError(await getError(requestError, 'Could not load accounts.')) }
    finally { setLoading(false) }
  }, [appliedSearch, appliedStatus, getError, page, refreshKey])
  useEffect(() => { void load() }, [load])

  async function changeStatus(reason: string) {
    if (!selected) return
    const nextStatus = selected.status === 'ACTIVE' ? 'FROZEN' : 'ACTIVE'
    setSaving(true); setActionError('')
    try {
      await api.patch(`/admin/accounts/${selected.id}/status`, { status: nextStatus, reason })
      setSelected(null)
      await load()
    } catch (requestError) { setActionError(await getError(requestError, 'Could not update account status.')) }
    finally { setSaving(false) }
  }

  return <Card>
    <div className="page-heading"><div><span className="section-kicker">Admin operations</span><h1>Account operations</h1><p>Freeze or unfreeze accounts using guarded state transitions. Balances and ledger entries are not editable here.</p></div><Button variant="secondary" onClick={() => void load()} disabled={loading}>Refresh</Button></div>
    <form className="admin-filter-bar" onSubmit={(event) => { event.preventDefault(); setPage(1); setAppliedSearch(search.trim()); setAppliedStatus(status) }}>
      <input className="ui-input" aria-label="Search accounts" placeholder="Account number, owner, or currency" maxLength={120} value={search} onChange={(event) => setSearch(event.target.value)} />
      <select className="ui-input" aria-label="Filter accounts by status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option><option>ACTIVE</option><option>FROZEN</option><option>CLOSED</option></select>
      <Button type="submit" size="sm">Apply filters</Button>
    </form>
    {error && <div className="form-error" role="alert">{error}</div>}
    {loading ? <p className="page-copy">Loading accounts…</p> : <Table headers={['Account number', 'Owner', 'Currency', 'Balance', 'Status', 'Created', 'Action']} rows={rows.map(account => [
      <code>{account.accountNumber}</code>,
      <span><strong>{account.user.name}</strong><small className="admin-secondary">{account.user.email}</small></span>,
      account.eligibleForFinancialOperations ? 'INR' : `${account.currency} (legacy)`,
      `${(Number(account.balanceMinor) / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}`,
      <Badge tone={account.status === 'ACTIVE' ? 'success' : account.status === 'FROZEN' ? 'warning' : 'neutral'}>{account.status}</Badge>,
      new Date(account.createdAt).toLocaleString(),
      account.status !== 'CLOSED' ? <span className="dialog-actions"><Button size="sm" variant={account.status === 'ACTIVE' ? 'danger' : 'secondary'} onClick={() => { setSelected(account); setActionError('') }}>{account.status === 'ACTIVE' ? 'Freeze' : 'Unfreeze'}</Button></span> : '—'
    ])} />}
    <Pager pagination={pagination} onPage={setPage} />
    {selected && <ActionDialog title={selected.status === 'ACTIVE' ? 'Freeze account' : 'Unfreeze account'} target={selected.accountNumber} saving={saving} error={actionError} onClose={() => setSelected(null)} onConfirm={(reason) => void changeStatus(reason)} />}
  </Card>
}

export function AdminFundingPage({}: AdminOperationsProps) {
  const getError = useAdminRequestError()
  const [selected, setSelected] = useState<RecipientRow | null>(null)
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const amountMinor = /^\d+(\.\d{1,2})?$/.test(amount.trim())
    ? (() => {
      const [whole, fraction = ''] = amount.trim().split('.')
      try { return (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))).toString() } catch { return '' }
    })()
    : ''
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!selected || !amountMinor || amountMinor === '0' || !reason.trim()) return
    setSaving(true); setError(''); setMessage('')
    try {
      await api.post('/admin/funding', {
        accountId: selected.accountId, amountMinor, currency: 'INR', reason: reason.trim()
      }, { headers: { 'Idempotency-Key': crypto.randomUUID() } })
      setMessage(`Internal INR funding credit completed for ${selected.accountNumber}.`)
      setAmount(''); setReason('')
    } catch (requestError) {
      setError(await getError(requestError, 'Could not complete the admin transfer.'))
    } finally { setSaving(false) }
  }

  return <Card>
    <div className="page-heading"><div><span className="section-kicker">Privileged operation</span><h1>Admin transfer</h1><p>Credit an eligible customer INR account without debiting an administrator account.</p></div></div>
    {message && <div className="profile-success" role="status">{message}</div>}
    {error && <div className="form-error" role="alert">{error}</div>}
    <form className="admin-action-dialog" onSubmit={(event) => void submit(event)}>
      <label className="field"><span className="field-label">Recipient account</span><RecipientCombobox selected={selected} onSelect={(recipient) => { setSelected(recipient); setMessage(''); setError('') }} onClear={() => setSelected(null)} /></label>
      {selected && <div className="review-list"><div><span>Account holder</span><strong>{selected.holderName}</strong></div><div><span>Account number</span><strong>{maskAccountNumber(selected.accountNumber)}</strong></div><div><span>Currency</span><strong>INR</strong></div></div>}
      <label className="field"><span className="field-label">Amount (INR)</span><input className="ui-input" type="number" min="0.01" step="0.01" required value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
      <label className="field"><span className="field-label">Reason (required)</span><textarea className="ui-input" maxLength={1000} required value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      <p className="admin-secondary">Review: this creates an internal LedgerGuard funding credit, records the admin audit event, and does not represent an external bank deposit.</p>
      <div className="dialog-actions"><Button type="submit" disabled={saving || !selected || !amountMinor || amountMinor === '0' || !reason.trim()}>{saving ? 'Crediting…' : 'Confirm admin transfer'}</Button></div>
    </form>
  </Card>
}

type AdministratorRow = UserRow & { isAdmin: boolean; bootstrapAdmin?: boolean }

export function AdminRolesPage() {
  const { user } = useAuth()
  const getError = useAdminRequestError()
  const [administrators, setAdministrators] = useState<AdministratorRow[]>([])
  const [eligibleUsers, setEligibleUsers] = useState<UserRow[]>([])
  const [search, setSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [selected, setSelected] = useState<{ user: AdministratorRow | UserRow; action: 'PROMOTE' | 'DEMOTE' } | null>(null)
  const [actionError, setActionError] = useState('')
  const [reason, setReason] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [adminResponse, eligibleResponse] = await Promise.all([
        api.get<{ administrators: AdministratorRow[] }>('/admin/administrators'),
        api.get<{ users: UserRow[] }>('/admin/eligible-admin-users', {
          params: appliedSearch ? { search: appliedSearch } : {}
        })
      ])
      setAdministrators(adminResponse.data.administrators)
      setEligibleUsers(eligibleResponse.data.users)
    } catch (requestError) {
      setError(await getError(requestError, 'Could not load administrator roles.'))
    } finally {
      setLoading(false)
    }
  }, [appliedSearch, getError])

  useEffect(() => { void load() }, [load])

  async function changeRole(reason: string) {
    if (!selected) return
    setSaving(true)
    setActionError('')
    setMessage('')
    try {
      await api.patch(`/admin/users/${selected.user.id}/admin-role`, {
        action: selected.action,
        reason
      })
      setMessage(`${selected.user.name} was ${selected.action === 'PROMOTE' ? 'promoted to' : 'removed from'} administrator access.`)
      setSelected(null)
      await load()
    } catch (requestError) {
      setActionError(await getError(requestError, 'Could not change administrator access.'))
    } finally {
      setSaving(false)
    }
  }

  return <Card>
    <div className="page-heading"><div><span className="section-kicker">Admin operations</span><h1>Administrator roles</h1><p>Promote verified active users or remove access from secondary administrators. Every role change is confirmed and audited.</p></div><Button variant="secondary" onClick={() => void load()} disabled={loading}>Refresh</Button></div>
    {error && <div className="form-error" role="alert">{error}</div>}
    {message && <div className="profile-success" role="status">{message}</div>}
    <div className="panel-heading"><div><span className="section-kicker">Current access</span><h2>Administrators</h2></div></div>
    {loading ? <p className="page-copy">Loading administrator roles…</p> : <Table headers={['Administrator', 'Status', 'Email verified', 'Access source', 'Action']} rows={administrators.map(admin => [
      <span><strong>{admin.name}</strong><small className="admin-secondary">{admin.email}</small></span>,
      <Badge tone={admin.status === 'ACTIVE' ? 'success' : 'warning'}>{admin.status}</Badge>,
      admin.emailVerifiedAt ? new Date(admin.emailVerifiedAt).toLocaleDateString() : 'No',
      admin.bootstrapAdmin ? 'Bootstrap administrator' : 'Secondary administrator',
      admin.bootstrapAdmin || admin.id === user?.id
        ? <span className="admin-secondary">{admin.id === user?.id ? 'Your role' : 'Protected'}</span>
        :         <Button size="sm" variant="danger" onClick={() => { setSelected({ user: admin, action: 'DEMOTE' }); setActionError(''); setReason('') }}>Remove access</Button>
    ])} />}
    <div className="admin-role-candidates">
      <div className="panel-heading"><div><span className="section-kicker">Eligible accounts</span><h2>Grant administrator access</h2></div></div>
      <form className="admin-filter-bar" onSubmit={(event) => { event.preventDefault(); setAppliedSearch(search.trim()) }}>
        <input className="ui-input" aria-label="Search eligible users" placeholder="Search by name, email, or ID" maxLength={120} value={search} onChange={(event) => setSearch(event.target.value)} />
        <Button type="submit" size="sm" disabled={loading}>Search users</Button>
      </form>
      {loading ? <p className="page-copy">Loading eligible users…</p> : eligibleUsers.length ? <Table headers={['User', 'Email verified', 'Created', 'Action']} rows={eligibleUsers.map(candidate => [
        <span><strong>{candidate.name}</strong><small className="admin-secondary">{candidate.email}</small></span>,
        candidate.emailVerifiedAt ? new Date(candidate.emailVerifiedAt).toLocaleDateString() : 'No',
        new Date(candidate.createdAt).toLocaleDateString(),
        <Button size="sm" onClick={() => { setSelected({ user: candidate, action: 'PROMOTE' }); setActionError(''); setReason('') }}>Promote</Button>
      ])} /> : <p className="page-copy">No eligible verified active users match this search.</p>}
    </div>
    {selected && <Dialog open title={selected.action === 'PROMOTE' ? 'Promote administrator' : 'Remove administrator access'} onClose={() => !saving && setSelected(null)}>
      <div className="admin-action-dialog">
        <p>Confirm this role change for <strong>{selected.user.name}</strong> (<span>{selected.user.email}</span>).</p>
        <label className="field"><span className="field-label">Reason (required)</span><textarea className="ui-input" maxLength={1000} required value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        {actionError && <div className="form-error" role="alert">{actionError}</div>}
        <div className="dialog-actions"><Button variant="ghost" disabled={saving} onClick={() => setSelected(null)}>Cancel</Button><Button variant={selected.action === 'DEMOTE' ? 'danger' : 'primary'} disabled={saving || !reason.trim()} onClick={() => void changeRole(reason.trim())}>{saving ? 'Saving…' : 'Confirm role change'}</Button></div>
      </div>
    </Dialog>}
  </Card>
}

export function AdminAuditPage({ refreshKey = 0 }: AdminOperationsProps) {
  const getError = useAdminRequestError()
  const [rows, setRows] = useState<AuditEvent[]>([])
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 20, total: 0, totalPages: 0 })
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const response = await api.get<{ events: AuditEvent[]; pagination: Pagination }>('/admin/audit', { params: { page, pageSize: 20 } })
      setRows(response.data.events); setPagination(response.data.pagination)
    } catch (requestError) { setError(await getError(requestError, 'Could not load the audit log.')) }
    finally { setLoading(false) }
  }, [getError, page, refreshKey])
  useEffect(() => { void load() }, [load])

  return <Card>
    <div className="page-heading"><div><span className="section-kicker">Immutable operations record</span><h1>Audit log</h1><p>Administrative changes with actor, action, target, reason, timestamp, and safe metadata.</p></div><Button variant="secondary" onClick={() => void load()} disabled={loading}>Refresh</Button></div>
    {error && <div className="form-error" role="alert">{error}</div>}
    {loading ? <p className="page-copy">Loading audit events…</p> : <Table headers={['When', 'Actor', 'Action', 'Target', 'Reason', 'Metadata']} rows={rows.map(event => [
      new Date(event.createdAt).toLocaleString(),
      <span><strong>{event.actor.name}</strong><small className="admin-secondary">{event.actor.email}</small></span>,
      <Badge>{event.action}</Badge>,
      <span>{event.targetType}<small className="admin-secondary"><code>{event.targetId}</code></small></span>,
      event.reason || '—',
      event.metadata ? <code>{JSON.stringify(event.metadata)}</code> : '—'
    ])} />}
    <Pager pagination={pagination} onPage={setPage} />
  </Card>
}

export function AdminTransactionMonitor({ refreshKey = 0 }: AdminOperationsProps) {
  const getError = useAdminRequestError()
  const [rows, setRows] = useState<MonitoredTransfer[]>([])
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 20, total: 0, totalPages: 0 })
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const [selectedAccount, setSelectedAccount] = useState<RecipientRow | null>(null)
  const [riskLevel, setRiskLevel] = useState('')
  const [riskDecision, setRiskDecision] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [filters, setFilters] = useState({ status: '', accountId: '', riskLevel: '', riskDecision: '', from: '', to: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const response = await api.get<{ transfers: MonitoredTransfer[]; pagination: Pagination }>('/admin/transfers', {
        params: { page, pageSize: 20, ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)) }
      })
      setRows(response.data.transfers); setPagination(response.data.pagination)
    } catch (requestError) { setError(await getError(requestError, 'Could not load transfer monitoring.')) }
    finally { setLoading(false) }
  }, [filters, getError, page, refreshKey])
  useEffect(() => { void load() }, [load])

  return <Card className="admin-monitor-card">
    <div className="page-heading"><div><span className="section-kicker">Transaction monitoring</span><h1>All transfers</h1><p>Filter by status, time range, account number, and risk assessment.</p></div><Button variant="secondary" onClick={() => void load()} disabled={loading}>Refresh</Button></div>
    <form className="admin-filter-bar admin-transfer-filters" onSubmit={(event) => { event.preventDefault(); setPage(1); setFilters({ status, accountId: selectedAccount?.accountId || '', riskLevel, riskDecision, from, to }) }}>
      <select className="ui-input" aria-label="Filter transfers by status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option>{['PENDING', 'PROCESSING', 'COMPLETED', 'REVIEW', 'FAILED', 'REVERSED'].map(value => <option key={value}>{value}</option>)}</select>
      <RecipientCombobox
  selected={selectedAccount}
  onSelect={setSelectedAccount}
  onClear={() => setSelectedAccount(null)}
/>
      <select className="ui-input" aria-label="Filter by risk level" value={riskLevel} onChange={(event) => setRiskLevel(event.target.value)}><option value="">All risk levels</option>{['LOW', 'MEDIUM', 'HIGH'].map(value => <option key={value}>{value}</option>)}</select>
      <select className="ui-input" aria-label="Filter by risk decision" value={riskDecision} onChange={(event) => setRiskDecision(event.target.value)}><option value="">All risk decisions</option>{['PENDING', 'APPROVED', 'REVIEW', 'DECLINED'].map(value => <option key={value}>{value}</option>)}</select>
      <label className="admin-date-filter">From<input className="ui-input" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label className="admin-date-filter">To<input className="ui-input" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      <Button type="submit" size="sm">Apply filters</Button>
    </form>
    {error && <div className="form-error" role="alert">{error}</div>}
    {loading ? <p className="page-copy">Loading transfers…</p> : <Table headers={['Transfer', 'Status', 'Amount', 'Created', 'Funding To / Recipient Account', 'Risk']} rows={rows.map(transfer => [
      <code>{transfer.id}</code>,
      <Badge tone={transfer.status === 'REVIEW' ? 'warning' : transfer.status === 'COMPLETED' ? 'success' : 'neutral'}>{transfer.status}</Badge>,
      `${transfer.currency} ${(Number(transfer.amountMinor) / 100).toLocaleString()}`,
      new Date(transfer.createdAt).toLocaleString(),
      <span><small className="admin-secondary">Funding To / Recipient Account</small><strong>{transfer.receiverAccountNumber || 'Unavailable'}</strong></span>,
      transfer.risk ? <span>{transfer.risk.level} · {transfer.risk.decision} · {transfer.risk.score}<small className="admin-secondary">{JSON.stringify(transfer.risk.reasons)}</small></span> : 'Not assessed'
    ])} />}
    <Pager pagination={pagination} onPage={setPage} />
  </Card>
}
