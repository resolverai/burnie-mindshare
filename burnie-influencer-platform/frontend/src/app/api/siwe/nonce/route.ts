import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';

export async function GET() {
  const nonce = randomBytes(32).toString('hex');
  
  // Store nonce in memory (in production, use Redis or database)
  // For now, we'll just return it and trust the client
  return new NextResponse(nonce, {
    headers: {
      'Content-Type': 'text/plain',
    },
  });
}
