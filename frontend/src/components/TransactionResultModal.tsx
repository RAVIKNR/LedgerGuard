import { useEffect, useRef, useState } from 'react'
import { Check, Clock3, Volume2, VolumeX, X } from 'lucide-react'
import { Button } from './ui'
import { LedgerObject } from './LedgerObject'
import { isSuccessSoundEnabled, playTransactionSound, setSuccessSoundEnabled } from '../lib/successSound'

type Transaction = {
  id: string
  reference?: string | null
  amountMinor: string
  currency: string
  status: string
  createdAt: string
  receiverAccountNumber?: string | null
}

export function TransactionResultModal({
  transaction,
  failureAttempt,
  recipientName,
  recipientAccount,
  message,
  onClose,
  onRetry,
  onCheckStatus,
  onPayAgain,
  checking
}: {
  transaction?: Transaction
  failureAttempt?: {
    id: string
    amountMinor: string
    currency: string
    sourceAccount: string
    availableBalanceMinor: string
    requiredAmountMinor: string
  }
  recipientName?: string
  recipientAccount?: string
  message: string
  onClose: () => void
  onRetry?: () => void
  onCheckStatus?: () => void
  onPayAgain?: () => Promise<void>
  checking?: boolean
}) {
  const closeButton = useRef<HTMLButtonElement>(null)
  const [soundEnabled, setSoundEnabled] = useState(isSuccessSoundEnabled)
  const [payAgainLoading, setPayAgainLoading] = useState(false)
  const kind = failureAttempt ? 'failure' : transaction?.status === 'COMPLETED' ? 'success' : transaction?.status === 'FAILED' ? 'failure' : 'pending'
  const amountMinor = failureAttempt?.amountMinor || transaction?.amountMinor || '0'
  const currency = failureAttempt?.currency || transaction?.currency || 'INR'
  const transactionId = failureAttempt?.id || transaction?.id || ''
  const amount = new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(amountMinor) / 100)

  useEffect(() => {
    playTransactionSound(kind, transactionId)
    closeButton.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [kind, onClose, transactionId])

  function toggleSound() {
    const enabled = !soundEnabled
    setSuccessSoundEnabled(enabled)
    setSoundEnabled(enabled)
    window.dispatchEvent(new Event('ledgerguard-sound-preference'))
  }

  async function payAgain() {
    if (!onPayAgain || payAgainLoading) return
    setPayAgainLoading(true)
    try {
      await onPayAgain()
    } finally {
      setPayAgainLoading(false)
    }
  }

  const title = kind === 'success' ? 'Payment Successful' : kind === 'failure' ? 'TRANSACTION FAILED' : 'Payment Pending'
  const description = failureAttempt ? 'Insufficient Funds' : message

  return <div className={`transaction-result-backdrop ${kind}`} role="presentation">
    <section className="transaction-result-modal" role="dialog" aria-modal="true" aria-labelledby="transaction-result-title">
      <button ref={closeButton} className="transaction-result-close" type="button" onClick={onClose} aria-label="Close payment result"><X size={16} /></button>
      <div className="transaction-result-art" aria-hidden="true">
        <LedgerObject variant={kind} className="transaction-result-object" />
        <span className="transaction-result-symbol">{kind === 'success' ? <Check size={25} /> : kind === 'failure' ? <X size={25} /> : <Clock3 size={24} />}</span>
      </div>
      <span className="section-kicker">{kind === 'success' ? 'Transaction confirmed' : kind === 'failure' ? 'No completed debit' : 'Ledger processing'}</span>
      <h2 id="transaction-result-title">{title}</h2>
      <p className="transaction-result-copy">{description}</p>
      <div className="transaction-result-details">
        <div><span>Amount</span><strong>{amount}</strong></div>
        {recipientName && <div><span>Recipient</span><strong>{recipientName}</strong></div>}
        {recipientAccount && <div><span>Account</span><strong>{recipientAccount}</strong></div>}
        {failureAttempt && <div><span>Source account</span><strong>{failureAttempt.sourceAccount}</strong></div>}
        {failureAttempt && <div><span>Available / required</span><strong>{new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(failureAttempt.availableBalanceMinor) / 100)} / {new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(failureAttempt.requiredAmountMinor) / 100)}</strong></div>}
        {transaction && <><div><span>Status</span><strong>{transaction.status}</strong></div><div><span>Reference</span><strong>{transaction.reference || transaction.id}</strong></div><div><span>Submitted</span><strong>{new Date(transaction.createdAt).toLocaleString()}</strong></div></>}
      </div>
      <div className="transaction-result-actions">
        <Button type="button" variant="secondary" onClick={toggleSound} aria-label={soundEnabled ? 'Mute payment sound' : 'Enable payment sound'}>
          {soundEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />} {soundEnabled ? 'Sound on' : 'Sound off'}
        </Button>
        {onPayAgain && <Button type="button" variant="secondary" onClick={() => void payAgain()} disabled={payAgainLoading || checking}>{payAgainLoading ? 'Verifying…' : 'Pay Again'}</Button>}
        {kind === 'success' && <Button type="button" onClick={onClose}>Done</Button>}
        {kind === 'failure' && <><Button type="button" variant="ghost" onClick={onClose}>Close</Button><Button type="button" onClick={onRetry}>Try Again</Button></>}
        {kind === 'pending' && <><Button type="button" variant="ghost" onClick={onClose}>Close</Button><Button type="button" onClick={onCheckStatus} disabled={checking}>{checking ? 'Checking…' : 'Check Status'}</Button></>}
      </div>
    </section>
  </div>
}
