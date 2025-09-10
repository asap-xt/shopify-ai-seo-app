// frontend/src/hooks/useShopApi.js
import { useMemo } from 'react';
import { useAppBridge } from '@shopify/app-bridge-react';
import { makeApiFetch } from '../lib/apiFetch.js';

/**
 * Custom hook за лесна работа с Shopify API
 * Връща готов api клиент и shop параметъра
 */
export function useShopApi() {
  const app = useAppBridge();
  const api = useMemo(() => makeApiFetch(app), [app]);
  
  const shop = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('shop') || '';
  }, []);

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