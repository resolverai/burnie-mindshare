import { useState, useEffect } from 'react'
import { useWeb2Auth } from './useWeb2Auth'

interface Account {
  id: string
  account_type: 'individual' | 'business' | 'agency'
  business_name: string
  industry: string
  use_case: string[]
  status: string
}

interface BrandContext {
  id: string
  brand_name: string
  brand_tagline?: string
  brand_description?: string
  brand_values?: string[]
  target_audience?: string
  tone_of_voice?: string[]
  color_palette?: {
    primary?: string
    secondary?: string
    accent?: string
  }
  logo_url?: string
  product_images?: string[]
  brand_aesthetics?: string
  content_preferences?: any
}

interface UseAccountContextReturn {
  account: Account | null
  brandContext: BrandContext | null
  isLoading: boolean
  error: string | null
  fetchAccount: () => Promise<void>
  fetchBrandContext: () => Promise<void>
  updateAccount: (data: Partial<Account>) => Promise<void>
  updateBrandContext: (data: Partial<BrandContext>) => Promise<void>
}

export function useAccountContext(): UseAccountContextReturn {
  const { user, token, isAuthenticated } = useWeb2Auth()
  const [account, setAccount] = useState<Account | null>(null)
  const [brandContext, setBrandContext] = useState<BrandContext | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isAuthenticated && user) {
      fetchAccount()
      fetchBrandContext()
    }
  }, [isAuthenticated, user])

  const fetchAccount = async () => {
    if (!user || !token) return

    try {
      setIsLoading(true)
      setError(null)

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api'}/web2-accounts/${user.account_id}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      )

      if (!response.ok) {
        throw new Error('Failed to fetch account')
      }

      const data = await response.json()
      setAccount(data.data)
    } catch (err) {
      console.error('Fetch account error:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch account')
    } finally {
      setIsLoading(false)
    }
  }

  const fetchBrandContext = async () => {
    if (!user || !token) return

    try {
      setIsLoading(true)
      setError(null)

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api'}/web2-brand-context/account/${user.account_id}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      )

      if (response.status === 404) {
        // No brand context yet, that's okay
        setBrandContext(null)
        return
      }

      if (!response.ok) {
        throw new Error('Failed to fetch brand context')
      }

      const data = await response.json()
      setBrandContext(data.data)
    } catch (err) {
      console.error('Fetch brand context error:', err)
      // Don't set error for 404, it's expected for new accounts
      if (err instanceof Error && !err.message.includes('404')) {
        setError(err.message)
      }
    } finally {
      setIsLoading(false)
    }
  }

  const updateAccount = async (data: Partial<Account>) => {
    if (!user || !token) return

    try {
      setIsLoading(true)
      setError(null)

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api'}/web2-accounts/${user.account_id}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify(data)
        }
      )

      if (!response.ok) {
        throw new Error('Failed to update account')
      }

      const result = await response.json()
      setAccount(result.data)
    } catch (err) {
      console.error('Update account error:', err)
      setError(err instanceof Error ? err.message : 'Failed to update account')
      throw err
    } finally {
      setIsLoading(false)
    }
  }

  const updateBrandContext = async (data: Partial<BrandContext>) => {
    if (!user || !token) return

    try {
      setIsLoading(true)
      setError(null)

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api'}/web2-brand-context/account/${user.account_id}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify(data)
        }
      )

      if (!response.ok) {
        throw new Error('Failed to update brand context')
      }

      const result = await response.json()
      setBrandContext(result.data)
    } catch (err) {
      console.error('Update brand context error:', err)
      setError(err instanceof Error ? err.message : 'Failed to update brand context')
      throw err
    } finally {
      setIsLoading(false)
    }
  }

  return {
    account,
    brandContext,
    isLoading,
    error,
    fetchAccount,
    fetchBrandContext,
    updateAccount,
    updateBrandContext
  }
}

