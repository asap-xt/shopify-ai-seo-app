// frontend/src/hooks/useFeatureFlags.js
import { useState, useEffect } from 'react';
import { makeSessionFetch } from '../lib/sessionFetch.js';

const qs = (k, d = '') => {
  try { return new URLSearchParams(window.location.search).get(k) || d; }
  catch { return d; }
};

export function useFeatureFlags() {
  const [flags, setFlags] = useState({
    useGraphQLCollections: false,
    // Default values
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchFlags = async () => {
      try {
        setLoading(true);
        const shop = qs('shop');
        const api = makeSessionFetch();
        
        const response = await api(`/api/feature-flags?shop=${encodeURIComponent(shop)}`, {
          method: 'GET',
          shop
        });

        console.log('[FEATURE-FLAGS] Received flags:', response);
        setFlags(response);
        setError(null);
      } catch (err) {
        console.error('[FEATURE-FLAGS] Error fetching flags:', err);
        setError(err);
        // Keep default flags on error
      } finally {
        setLoading(false);
      }
    };

    fetchFlags();
  }, []);

  return { flags, loading, error };
}
