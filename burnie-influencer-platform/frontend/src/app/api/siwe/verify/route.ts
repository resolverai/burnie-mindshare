import { NextRequest, NextResponse } from 'next/server';
import { verifyMessage } from 'viem';

export async function POST(request: NextRequest) {
  try {
    const { message, signature } = await request.json();

    // Extract address from message (simple parsing)
    const addressMatch = message.match(/Wallet: (0x[a-fA-F0-9]{40})/);
    if (!addressMatch) {
      return NextResponse.json({ error: 'Invalid message format' }, { status: 400 });
    }

    const address = addressMatch[1] as `0x${string}`;

    // Verify the signature
    const isValid = await verifyMessage({
      address,
      message,
      signature: signature as `0x${string}`,
    });

    if (isValid) {
      return NextResponse.json({ 
        success: true, 
        address,
        message: 'Authentication successful' 
      });
    } else {
      return NextResponse.json({ 
        success: false, 
        error: 'Invalid signature' 
      }, { status: 401 });
    }
  } catch (error) {
    console.error('Error verifying SIWE signature:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Verification failed' 
    }, { status: 500 });
  }
}
