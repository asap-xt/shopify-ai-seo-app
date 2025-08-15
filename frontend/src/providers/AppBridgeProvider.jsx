import React, {useMemo} from 'react'
import {Provider as AppBridgeProvider} from '@shopify/app-bridge-react'

export default function ShopifyAppBridgeProvider({children}) {
  const params = new URLSearchParams(window.location.search)
  const host = params.get('host')
  const apiKey = import.meta.env.VITE_SHOPIFY_API_KEY

  // Ако няма host (отворено е standalone) – main.jsx вече опита redirect към Admin.
  if (!host || !apiKey) return null

  const config = useMemo(() => ({
    apiKey,
    host,
    forceRedirect: true
  }), [apiKey, host])

  return (
    <AppBridgeProvider config={config}>
      {children}
    </AppBridgeProvider>
  )
}
