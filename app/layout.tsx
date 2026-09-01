import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Vesta | AI Treasury Guardian',
  description:
    'An Intelligent Contract that adjudicates AI agent spending by validator consensus and enforces the treasury policy itself.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
