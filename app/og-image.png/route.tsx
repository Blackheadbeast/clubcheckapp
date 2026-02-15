import { ImageResponse } from 'next/og'

export const runtime = 'edge'

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#0a0a0a',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            marginBottom: '32px',
          }}
        >
          <div
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '16px',
              background: 'linear-gradient(135deg, #f5a623, #e09100)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '32px',
              fontWeight: 700,
              color: '#000',
            }}
          >
            CC
          </div>
          <span style={{ fontSize: '48px', fontWeight: 700, color: '#f0f0f0' }}>
            ClubCheck
          </span>
        </div>
        <div
          style={{
            fontSize: '28px',
            color: '#f5a623',
            fontWeight: 600,
            marginBottom: '16px',
          }}
        >
          Gym Management Made Simple
        </div>
        <div
          style={{
            fontSize: '20px',
            color: '#888',
            maxWidth: '600px',
            textAlign: 'center',
            lineHeight: 1.5,
          }}
        >
          Members, check-ins, payments, and staff — organized in one place.
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  )
}
