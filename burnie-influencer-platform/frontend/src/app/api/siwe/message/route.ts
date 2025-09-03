import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { address, chainId, nonce } = body;

    const message = `Welcome to Burnie - Yapper Platform!

Please sign this message to authenticate your wallet.

Wallet: ${address}
Chain ID: ${chainId}
Nonce: ${nonce}
Timestamp: ${new Date().toISOString()}

This signature proves you own this wallet.`;

    return new NextResponse(message, {
      headers: {
        'Content-Type': 'text/plain',
      },
    });
  } catch (error) {
    console.error('Error creating SIWE message:', error);
    return NextResponse.json({ error: 'Failed to create message' }, { status: 500 });
  }
}
