// frontend/src/hooks/useShopApi.js
import { useMemo, useState, useEffect, useCallback } from 'react';
import { apiJson, apiPost } from '../utils/api.js';

/**
 * Custom hook за лесна работа с Shopify API
 * Връща готов api клиент и shop параметъра
 */
const qs = (k, d = '') => {
  try { return new URLSearchParams(window.location.search).get(k) || d; }
  catch { return d; }
};

export function useShopApi() {
  const shop = qs('shop', '');
  
  // New API wrapper that automatically includes session tokens and shop parameter
  const api = useMemo(() => async (endpoint, options = {}) => {
    // Ensure shop parameter is always included
    const url = new URL(endpoint, window.location.origin);
    if (!url.searchParams.has('shop') && shop) {
      url.searchParams.set('shop', shop);
    }
    
    if (options.method === 'POST' || options.body) {
      return apiPost(url.pathname + url.search, options.body || {}, options);
    } else {
      return apiJson(url.pathname + url.search, options);
    }
  }, [shop]);

  return { api, shop };
}

/**
 * Hook за директно извикване на API endpoint
 * Автоматично зарежда данните при mount
 */
export function useApiCall(endpoint, options = {}) {
  const { api, shop } = useShopApi();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchData = useCallback(async () => {
    if (!shop) {
      setError('Missing shop parameter');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError('');
      const result = await api(endpoint, { ...options, shop });
      setData(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [api, shop, endpoint, JSON.stringify(options)]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}