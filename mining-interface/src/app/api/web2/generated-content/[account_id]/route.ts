import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  request: NextRequest,
  { params }: { params: { account_id: string } }
) {
  try {
    const { account_id } = params
    const { searchParams } = new URL(request.url)
    const page = searchParams.get('page') || '1'
    const limit = searchParams.get('limit') || '50'
    const content_type = searchParams.get('content_type')
    const status = searchParams.get('status')

    // Build query parameters
    const queryParams = new URLSearchParams({
      page,
      limit
    })
    
    if (content_type) queryParams.append('content_type', content_type)
    if (status) queryParams.append('status', status)

    // Call TypeScript backend
    const typescriptBackendUrl = process.env.NEXT_PUBLIC_TYPESCRIPT_BACKEND_URL || 'http://localhost:3001'
    const response = await fetch(
      `${typescriptBackendUrl}/api/web2-generated-content/${account_id}?${queryParams.toString()}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      }
    )

    if (!response.ok) {
      throw new Error(`TypeScript backend responded with ${response.status}`)
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Error fetching generated content:', error)
    return NextResponse.json(
      { error: 'Failed to fetch generated content' },
      { status: 500 }
    )
  }
}
