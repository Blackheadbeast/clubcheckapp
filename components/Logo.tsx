'use client'

import Image from 'next/image'
import Link from 'next/link'

interface LogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl'
  showText?: boolean
  linkToHome?: boolean
  className?: string
}

const sizes = {
  sm: { icon: 32, text: 'text-lg' },
  md: { icon: 40, text: 'text-xl' },
  lg: { icon: 48, text: 'text-2xl' },
  xl: { icon: 64, text: 'text-3xl' },
}

export default function Logo({ size = 'md', showText = true, linkToHome = false, className = '' }: LogoProps) {
  const { icon, text } = sizes[size]

  const content = (
    <div className={`flex items-center gap-3 ${className}`}>
      <Image
        src="/logo.png"
        alt="ClubCheck"
        width={icon}
        height={icon}
        className="rounded-xl"
        priority
      />
      {showText && (
        <span className={`font-bold bg-gradient-to-r from-primary to-primary-light bg-clip-text text-transparent ${text}`}>
          ClubCheck
        </span>
      )}
    </div>
  )

  if (linkToHome) {
    return (
      <Link href="/" className="inline-flex">
        {content}
      </Link>
    )
  }

  return content
}
