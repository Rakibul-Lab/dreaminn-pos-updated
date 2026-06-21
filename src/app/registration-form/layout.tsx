import type { Metadata } from 'next'

/** Bump when registration-form-a4.css changes so browsers fetch the latest file. */
export const REGISTRATION_FORM_CSS_VERSION = '20250620'

export const metadata: Metadata = {
  title: 'Guest Registration Form',
}

export default function RegistrationFormLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <link
        rel="stylesheet"
        href={`/registration-form-a4.css?v=${REGISTRATION_FORM_CSS_VERSION}`}
      />
      {children}
    </>
  )
}
