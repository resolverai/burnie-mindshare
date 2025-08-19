import { useState, useEffect } from 'react'
import { useAccount, useBalance } from 'wagmi'

function formatBalance(balance: number): string {
  if (balance >= 1000000) {
    return (balance / 1000000).toFixed(2) + 'M';
  } else if (balance >= 1000) {
    return (balance / 1000).toFixed(2) + 'K';
  } else {
    return balance.toFixed(2);
  }
}

export function useROASTBalance() {
  const { address, isConnected } = useAccount()
  const [balance, setBalance] = useState<string>('0')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Get ROAST token contract address from environment
  const ROAST_TOKEN_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ROAST_TOKEN as `0x${string}`

  // Use wagmi's useBalance hook for ERC20 token
  const { data: tokenBalance, isError, isLoading: balanceLoading, refetch } = useBalance({
    address: address,
    token: ROAST_TOKEN_ADDRESS,
    query: {
      enabled: isConnected && !!address && !!ROAST_TOKEN_ADDRESS,
    },
  })

  useEffect(() => {
    setIsLoading(balanceLoading)
    
    if (isError) {
      setError('Failed to fetch ROAST balance')
      setBalance('0')
    } else if (tokenBalance) {
      // Format the balance with K/M notation for large numbers
      const balanceNumber = parseFloat(tokenBalance.formatted)
      const formattedBalance = formatBalance(balanceNumber)
      setBalance(formattedBalance)
      setError(null)
    } else if (!isConnected) {
      setBalance('0')
      setError(null)
    }
  }, [tokenBalance, isError, balanceLoading, isConnected])

  return {
    balance,
    isLoading,
    error,
    refetch,
    symbol: tokenBalance?.symbol || 'ROAST'
  }
}
