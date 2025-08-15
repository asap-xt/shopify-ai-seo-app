import React from 'react'
import {Navigation} from '@shopify/polaris'
import {HomeIcon, ProductsIcon, SettingsIcon} from '@shopify/polaris-icons'

export default function AppNavigation() {
  return (
    <Navigation location="/">
      <Navigation.Section
        items={[
          {url: '/', label: 'Dashboard', icon: HomeIcon},
          {url: '/products', label: 'Products', icon: ProductsIcon},
          {url: '/settings', label: 'Settings', icon: SettingsIcon},
        ]}
      />
    </Navigation>
  )
}
