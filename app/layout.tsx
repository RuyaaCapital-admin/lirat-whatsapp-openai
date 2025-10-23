// app/layout.tsx
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'WhatsApp Webhook API',
  description: 'Serverless WhatsApp webhook with crypto price/signal commands and OpenAI Agent fallback',
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
