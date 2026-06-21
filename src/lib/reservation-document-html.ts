import { format } from 'date-fns'
import { formatConfirmationNumber } from './confirmation-number'
import {
  RESERVATION_TERMS_AND_CONDITIONS,
  HOTEL_RESERVATION_FOOTER,
  formatReservationMealPlan,
} from './reservation-terms'
import type { ReservationPdfData } from './reservation-pdf-data'
import { bookingVatOptions, computeBookingDisplayVat, computeRoomBookingTotals } from './booking-totals'

function idTypeLabel(type?: string | null) {
  if (type === 'passport') return 'Passport'
  if (type === 'driving_license') return 'Driving License'
  if (type === 'national_id') return 'National ID (NID)'
  return type || '—'
}

function esc(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

let logoDataUrlPromise: Promise<string> | null = null

export function getLogoDataUrl(): Promise<string> {
  if (!logoDataUrlPromise) {
    logoDataUrlPromise = (async () => {
      const url = `${typeof window !== 'undefined' ? window.location.origin : ''}/brand-logo.png`
      const res = await fetch(url)
      if (!res.ok) throw new Error('Could not load hotel logo')
      const blob = await res.blob()
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(blob)
      })
    })()
  }
  return logoDataUrlPromise
}

/** Self-contained HTML (hex colors only) matching the on-screen reservation document. */
export async function buildReservationDocumentHtml(data: ReservationPdfData): Promise<string> {
  const logoSrc = await getLogoDataUrl()
  const dueColor = data.dueAmount > 0 ? '#dc2626' : '#047857'
  const vatTotals = computeRoomBookingTotals(
    data.totalRoomCharge,
    data.advancePayment,
    bookingVatOptions(data)
  )
  const vatDisplay = computeBookingDisplayVat(data)
  const vatPercent = data.vatPercent ?? vatDisplay.percent
  const vatAmount = vatDisplay.amount
  const totalWithVat = data.totalWithVat ?? vatTotals.totalWithVat
  const vatInclNote = vatDisplay.mode === 'included' ? ' (incl. in rate)' : ''
  const vatRow = `<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span>VAT (${vatPercent}%${vatInclNote})</span><span>৳${vatAmount.toLocaleString()}</span></div>
      <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span>Total (incl. VAT)</span><span>৳${totalWithVat.toLocaleString()}</span></div>`

  const termsHtml = RESERVATION_TERMS_AND_CONDITIONS.map(
    (term) => `<li style="margin-bottom:4px">${esc(term.replace(/^\d+\.\s*/, ''))}</li>`
  ).join('')

  const notesHtml = data.notes
    ? `<section style="margin-top:20px;font-size:13px;color:#475569">
        <h3 style="font-size:14px;font-weight:600;color:#334155;margin:0 0 6px">Notes</h3>
        <p style="margin:0">${esc(data.notes)}</p>
      </section>`
    : ''

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
      background: #ffffff;
      color: #334155;
      padding: 24px;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <article id="reservation-document-article" style="max-width:720px;margin:0 auto;background:#ffffff">
    <header style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;border-bottom:1px solid #e2e8f0;padding-bottom:16px;margin-bottom:24px">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="width:48px;height:48px;border-radius:8px;border:1px solid #e2e8f0;overflow:hidden;flex-shrink:0">
          <img src="${logoSrc}" alt="RRP Dream Inn" width="48" height="48" style="width:48px;height:48px;object-fit:cover;display:block" />
        </div>
        <div>
          <p style="font-size:20px;font-weight:700;color:#1e293b;margin:0">RRP Dream Inn</p>
          <p style="font-size:13px;color:#64748b;margin:4px 0 0">Guest reservation confirmation</p>
        </div>
      </div>
      <div style="text-align:right;font-size:13px">
        <p style="color:#64748b;margin:0">Reservation no.</p>
        <p style="font-family:ui-monospace,monospace;font-weight:600;color:#b45309;margin:4px 0 0">${esc(formatConfirmationNumber({ id: data.reservationId, confirmationNumber: data.confirmationNumber }))}</p>
        <p style="font-size:11px;color:#64748b;margin:6px 0 0">${esc(format(new Date(data.createdAt), 'dd MMM yyyy, HH:mm'))}</p>
        ${data.status ? `<p style="font-size:11px;font-weight:500;text-transform:uppercase;color:#475569;margin:6px 0 0">${esc(data.status.replace(/_/g, ' '))}</p>` : ''}
      </div>
    </header>

    <section style="display:grid;grid-template-columns:1fr 1fr;gap:16px;font-size:13px;margin-bottom:24px">
      <div>
        <h3 style="font-size:14px;font-weight:600;color:#334155;margin:0 0 8px">Guest information</h3>
        <p style="margin:0 0 4px"><span style="color:#64748b">Name:</span> ${esc(data.guestName)}</p>
        <p style="margin:0 0 4px"><span style="color:#64748b">Phone:</span> ${esc(data.guestPhone)}</p>
        ${data.guestEmail ? `<p style="margin:0 0 4px"><span style="color:#64748b">Email:</span> ${esc(data.guestEmail)}</p>` : ''}
        ${data.guestAddress ? `<p style="margin:0 0 4px"><span style="color:#64748b">Address:</span> ${esc(data.guestAddress)}</p>` : ''}
        ${data.guestNationality ? `<p style="margin:0 0 4px"><span style="color:#64748b">Nationality:</span> ${esc(data.guestNationality)}</p>` : ''}
        ${data.guestRegistrationNumber ? `<p style="margin:0 0 4px"><span style="color:#64748b">Registration no.:</span> ${esc(data.guestRegistrationNumber)}</p>` : ''}
        <p style="margin:0 0 4px"><span style="color:#64748b">ID:</span> ${esc(idTypeLabel(data.idType))}</p>
        ${data.idNumber ? `<p style="margin:0 0 4px"><span style="color:#64748b">ID no.:</span> ${esc(data.idNumber)}</p>` : ''}
      </div>
      <div>
        <h3 style="font-size:14px;font-weight:600;color:#334155;margin:0 0 8px">Stay details</h3>
        <p style="margin:0 0 4px"><span style="color:#64748b">Room:</span> ${esc(data.roomNumber)} (${esc(data.roomType)})</p>
        <p style="margin:0 0 4px"><span style="color:#64748b">Check-in:</span> ${esc(format(new Date(data.checkIn), 'dd MMM yyyy'))}</p>
        <p style="margin:0 0 4px"><span style="color:#64748b">Check-out:</span> ${esc(format(new Date(data.checkOut), 'dd MMM yyyy'))}</p>
        <p style="margin:0 0 4px"><span style="color:#64748b">Guests:</span> ${data.adults} adult(s), ${data.children} child(ren)</p>
        <p style="margin:0"><span style="color:#64748b">Meal plan:</span> ${esc(data.mealPlan ?? formatReservationMealPlan(data.withMeal))}</p>
      </div>
    </section>

    <section style="border-radius:8px;background:#fffbeb;border:1px solid #fde68a;padding:16px;font-size:13px;margin-bottom:24px">
      <h3 style="font-size:14px;font-weight:600;color:#334155;margin:0 0 8px">Charges (BDT)</h3>
      <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span>Room rent</span><span>৳${data.totalRoomCharge.toLocaleString()}</span></div>
      ${vatRow}
      <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span>Advance paid</span><span>৳${data.advancePayment.toLocaleString()}</span></div>
      <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span>Form of payment</span><span>${esc(data.formOfPayment || 'Not paid at booking')}</span></div>
      <div style="display:flex;justify-content:space-between;font-weight:700;border-top:1px solid #fde68a;padding-top:8px;margin-top:8px">
        <span>Balance due</span>
        <span style="color:${dueColor}">৳${data.dueAmount.toLocaleString()}</span>
      </div>
    </section>

    ${notesHtml}

    <section style="font-size:11px;color:#475569;margin-top:20px">
      <h3 style="font-size:14px;font-weight:600;color:#1e293b;margin:0 0 8px">Terms &amp; conditions</h3>
      <ol style="padding-left:18px;margin:0">${termsHtml}</ol>
    </section>

    <section style="font-size:13px;margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0">
      <p style="color:#475569;margin:0 0 24px">
        I confirm that the information provided is accurate and I accept the hotel terms and conditions.
      </p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:32px">
        <div>
          <p style="font-size:11px;color:#64748b;margin:0 0 32px">Guest signature</p>
          <div style="border-bottom:1px solid #94a3b8;height:1px"></div>
        </div>
        <div>
          <p style="font-size:11px;color:#64748b;margin:0 0 32px">Authorized by (hotel)</p>
          <div style="border-bottom:1px solid #94a3b8;height:1px"></div>
        </div>
      </div>
    </section>

    <p style="text-align:center;font-size:11px;color:#94a3b8;margin-top:24px;padding-top:16px">${esc(HOTEL_RESERVATION_FOOTER)}</p>
  </article>
</body>
</html>`
}
