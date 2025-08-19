import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Burnie - Attention Economy Infrastructure',
  description: 'AI-powered content marketplace for yappers and content creators',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="light">
      <body className={`${inter.className} yapper-background`}>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  )
} 