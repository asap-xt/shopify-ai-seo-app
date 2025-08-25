// frontend/src/components/SideNav.jsx
import React from 'react';
import { Navigation } from '@shopify/polaris';
import { HomeIcon, ViewIcon, SettingsIcon } from '@shopify/polaris-icons';

export default function SideNav() {
  return (
    <Navigation location={window.location.pathname}>
      <Navigation.Section
        items={[
          { url: '/dashboard', label: 'Dashboard', icon: HomeIcon },
          { url: '/ai-seo',    label: 'AI SEO',   icon: ViewIcon },
          { url: '/billing',   label: 'Billing',  icon: ViewIcon },
        ]}
      />
      <Navigation.Section
        title="Settings"
        items={[
          { url: '/settings', label: 'App settings', icon: SettingsIcon },
        ]}
      />
    </Navigation>
  );
}