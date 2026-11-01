import { type ButtonHTMLAttributes, type ReactNode, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
}

export function Button({ variant = 'primary', size = 'md', className = '', ...props }: ButtonProps) {
  return <button className={`ui-button ${variant} ${size} ${className}`} {...props} />
}

export function Input({ label, hint, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: string }) {
  return <label className="field">{label && <span className="field-label">{label}</span>}<input className="ui-input" {...props} />{hint && <span className="field-hint">{hint}</span>}</label>
}

export function Card({ children, className = '', ...props }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return <div className={`ui-card ${className}`} {...props}>{children}</div>
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'success' | 'warning' | 'danger' }) {
  return <span className={`ui-badge ${tone}`}><i />{children}</span>
}

export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return <span className="tooltip-wrap" tabIndex={0}>{children}<span role="tooltip" className="tooltip">{label}</span></span>
}

export function Dialog({ open, title, children, onClose, portal = false }: { open: boolean; title: string; children: ReactNode; onClose: () => void; portal?: boolean }) {
  const closeButton = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  const reduceMotion = useReducedMotion()
  onCloseRef.current = onClose
  useEffect(() => {
    if (!open) return
    closeButton.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && onCloseRef.current()
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])
  const dialog = <AnimatePresence>{open && <motion.div className="dialog-backdrop" data-lenis-prevent role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()} initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={reduceMotion ? undefined : { opacity: 0 }}><motion.div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" initial={reduceMotion ? false : { opacity: 0, y: 12, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={reduceMotion ? undefined : { opacity: 0, y: 8, scale: .99 }} transition={{ duration: .2, ease: [0.22, 1, 0.36, 1] }}><div className="dialog-heading"><h2 id="dialog-title">{title}</h2><button ref={closeButton} className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={16} /></button></div>{children}</motion.div></motion.div>}</AnimatePresence>
  return portal && typeof document !== 'undefined' ? createPortal(dialog, document.body) : dialog
}

export function Table({ headers, rows }: { headers: string[]; rows: ReactNode[][] }) {
  return <div className="table-wrap" data-lenis-prevent><table><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div>
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <span className={`skeleton ${className}`} aria-hidden="true" />
}
