'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { HOTEL_LOCATION, HOTEL_NAME } from '@/lib/reservation-terms'
import {
  REGISTRATION_FORM_CHECKOUT_REMINDER,
  REGISTRATION_FORM_CONSENT,
  REGISTRATION_FORM_PDF_FILENAME,
  REGISTRATION_FORM_TERMS,
  REGISTRATION_FORM_TITLE,
  REGISTRATION_FORM_VAT_NOTE,
} from '@/lib/registration-form-blank'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
function RegLine({
  placeholder,
  className,
  short,
}: {
  placeholder?: string
  className?: string
  short?: boolean
}) {
  return (
    <input
      type="text"
      placeholder={placeholder}
      className={`rf-field-line${short ? ' rf-field-line--short' : ''}${className ? ` ${className}` : ''}`}
      aria-label={placeholder ?? 'Field'}
    />
  )
}

function RegCheckbox({ label }: { label: string }) {
  return (
    <div className="rf-cb-group">
      <input type="checkbox" id={`rf-cb-${label}`} />
      <label htmlFor={`rf-cb-${label}`}>{label}</label>
    </div>
  )
}

function RegFieldRow({
  label,
  placeholder,
  children,
}: {
  label: string
  placeholder?: string
  children?: React.ReactNode
}) {
  return (
    <div className="rf-field-row">
      <label>{label}</label>
      {children ?? <RegLine placeholder={placeholder} />}
    </div>
  )
}

interface BlankRegistrationFormViewProps {
  showToolbar?: boolean
}

/** Inline fallback so name fields stay 50/50 even if the CSS file is cached or slow to load. */
const RF_NAME_ROW_STYLE: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  columnGap: '20px',
  marginBottom: '9px',
}

export function BlankRegistrationFormView({ showToolbar = true }: BlankRegistrationFormViewProps) {
  const documentRef = useRef<HTMLDivElement>(null)
  const [downloadingPdf, setDownloadingPdf] = useState(false)
  const [printingPdf, setPrintingPdf] = useState(false)
  const [logoSrc, setLogoSrc] = useState('/brand-logo.png')

  useEffect(() => {
    import('@/lib/reservation-document-html')
      .then(({ getLogoDataUrl }) => getLogoDataUrl())
      .then(setLogoSrc)
      .catch(() => {})
  }, [])

  const handleDownloadPdf = async () => {
    if (!documentRef.current) return
    setDownloadingPdf(true)
    const toastId = toast.loading('Generating PDF…')
    try {
      const { downloadReservationPdfFromElement } = await import('@/lib/reservation-pdf')
      await downloadReservationPdfFromElement(documentRef.current, REGISTRATION_FORM_PDF_FILENAME)
      toast.success('PDF downloaded', { id: toastId })
    } catch (err) {
      console.error('PDF generation failed:', err)
      const msg = err instanceof Error ? err.message : 'Unknown error'
      toast.error(`Failed to generate PDF: ${msg}`, { id: toastId })
    } finally {
      setDownloadingPdf(false)
    }
  }

  const handlePrintPdf = async () => {
    if (!documentRef.current) return
    setPrintingPdf(true)
    const toastId = toast.loading('Opening registration form for print…')
    try {
      const { openReservationPdfInNewTab } = await import('@/lib/reservation-pdf')
      const opened = await openReservationPdfInNewTab(
        documentRef.current,
        REGISTRATION_FORM_PDF_FILENAME
      )
      if (!opened) {
        toast.error('Pop-up blocked. Allow pop-ups for this site, or use Download PDF.', {
          id: toastId,
        })
        return
      }
      toast.success('Registration form opened in a new tab — print from the browser PDF viewer', {
        id: toastId,
      })
    } catch (err) {
      console.error('Print preview failed:', err)
      const msg = err instanceof Error ? err.message : 'Unknown error'
      toast.error(`Failed to open print preview: ${msg}`, { id: toastId })
    } finally {
      setPrintingPdf(false)
    }
  }

  return (
    <div className="print-container flex flex-col items-center">
      {showToolbar && (
        <div className="mb-4 flex w-full max-w-[210mm] flex-wrap items-center justify-end gap-3 print:hidden">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => void handlePrintPdf()}
              disabled={printingPdf || downloadingPdf}
            >
              {printingPdf ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Opening…
                </>
              ) : (
                'Print'
              )}
            </Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={() => void handleDownloadPdf()}
              disabled={downloadingPdf || printingPdf}
            >
              {downloadingPdf ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating…
                </>
              ) : (
                'Download PDF'
              )}
            </Button>
          </div>
        </div>
      )}

      <div
        id="registration-form-document-root"
        ref={documentRef}
        className="registration-form-page"
      >
          <header className="rf-hotel-header">
            <div className="rf-logo-wrap">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logoSrc} alt={HOTEL_NAME} className="rf-logo" width={42} height={42} />
            </div>
            <h1>{HOTEL_NAME}</h1>
            <p>{HOTEL_LOCATION}</p>
            <div className="rf-form-title">{REGISTRATION_FORM_TITLE}</div>
          </header>

          <div className="rf-two-col rf-two-col--reg">
            <div className="rf-left-col" aria-hidden />
            <div className="rf-right-col">
              <RegFieldRow label="Registration No. :" />
            </div>
          </div>

          <div className="rf-two-col">
            <div className="rf-left-col">
              <RegFieldRow label="Arrival Date :" />
              <RegFieldRow label="Departure Date :" />
              <RegFieldRow label="Room Type :" />
              <RegFieldRow label="Room No :" />
              <RegFieldRow label="Rent :" />
            </div>
            <div className="rf-right-col">
              <div className="rf-field-row">
                <label>No. of Guest(s) :</label>
                <div className="rf-guest-counts">
                  <span className="rf-guest-count">
                    Adult:<RegLine short />
                  </span>
                  <span className="rf-guest-count">
                    Child:<RegLine short />
                  </span>
                </div>
              </div>
              <RegFieldRow label="Arrival Flight :" />
              <RegFieldRow label="ETA Time :" />
              <RegFieldRow label="Departure Flight :" />
              <RegFieldRow label="ETD Time :" />
            </div>
          </div>

          <div className="rf-vat-note">{REGISTRATION_FORM_VAT_NOTE}</div>

          <section className="rf-guest-section">
            <div className="rf-guest-title">Guest Informations :</div>
            <div className="rf-guest-options-row">
              <div className="rf-gender-row">
                <RegCheckbox label="Male" />
                <RegCheckbox label="Female" />
                <RegCheckbox label="Others" />
              </div>
              <div className="rf-staying-block">
                <span className="rf-panel-label rf-panel-label--inline">Staying Status :</span>
                <div className="rf-staying-group">
                  <RegCheckbox label="Day" />
                  <RegCheckbox label="Night" />
                </div>
              </div>
            </div>
            <div className="rf-guest-inner">
              <div className="rf-guest-left">
                <div className="rf-name-row" style={RF_NAME_ROW_STYLE}>
                  <RegFieldRow label="Name :" />
                  <RegFieldRow label="Name :" />
                </div>
                <RegFieldRow label="Passport No. / NID :" />
                <div className="rf-addr-row">
                  <RegFieldRow label="Address :" />
                  <RegFieldRow label="Email :" />
                  <RegFieldRow label="City / State :" />
                  <RegFieldRow label="Date of Birth :" />
                  <RegFieldRow label="Zip Code :" />
                  <RegFieldRow label="Nationality :" />
                  <RegFieldRow label="Country :" />
                  <RegFieldRow label="Occupation :" />
                </div>
              </div>
              <div className="rf-right-panel">
                <RegFieldRow label="Mobile No :" />
                <RegFieldRow label="Mobile No :" />
                <div className="rf-panel-label">Payment Mode :</div>
                <div className="rf-payment-group">
                  <RegCheckbox label="Cash" />
                  <RegCheckbox label="Credit Card" />
                  <RegCheckbox label="Company" />
                  <RegCheckbox label="M-Banking" />
                  <RegCheckbox label="Cheque" />
                  <RegCheckbox label="Bank" />
                </div>
              </div>
            </div>
          </section>

          <section className="rf-company-section">
            <div className="rf-company-title">Company Others Info. :</div>
            <div className="rf-comp-grid">
              <RegFieldRow label="Company Name :" />
              <RegFieldRow label="Email Address :" />
              <RegFieldRow label="Contact Person :" />
              <RegFieldRow label="Reference By :" />
              <div className="rf-field-row rf-comp-full">
                <label>Contact Phone No. :</label>
                <RegLine />
              </div>
            </div>
          </section>

          <section className="rf-terms">
            <div className="rf-terms-title">GENERAL TERMS AND CONDITIONS</div>
            <ul>
              {REGISTRATION_FORM_TERMS.map((term) => (
                <li key={term.title}>
                  <strong>{term.title}:</strong> {term.text}
                </li>
              ))}
            </ul>
          </section>

          <div className="rf-consent">{REGISTRATION_FORM_CONSENT}</div>

          <div className="rf-sign-row">
            <div className="rf-sign-field">
              <span className="rf-sign-label">Checked In By :</span>
              <span className="rf-sign-line" />
            </div>
            <div className="rf-sign-field">
              <span className="rf-sign-label">Date :</span>
              <span className="rf-sign-line" />
            </div>
            <div className="rf-sign-field">
              <span className="rf-sign-label">Guest Signature :</span>
              <span className="rf-sign-line" />
            </div>
          </div>

        <p className="rf-reminder">{REGISTRATION_FORM_CHECKOUT_REMINDER}</p>
      </div>
    </div>
  )
}
