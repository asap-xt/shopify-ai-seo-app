import React, {useMemo} from 'react'
import {Provider as AppBridgeProvider} from '@shopify/app-bridge-react'

export default function ShopifyAppBridgeProvider({children}) {
  const params = new URLSearchParams(window.location.search)
  const host = params.get('host')
  const apiKey = import.meta.env.VITE_SHOPIFY_API_KEY

  // If no host (opened standalone), don't initialize
  if (!host || !apiKey) return null

  const config = useMemo(() => ({
    apiKey,
    host,
    forceRedirect: false  // IMPORTANT: Changed from true to false
  }), [apiKey, host])

  return (
    <AppBridgeProvider config={config}>
      {children}
    </AppBridgeProvider>
  )
}