export function formatProductForAI(product) {
  return {
    productId: product.id,
    title: product.title,
    description: product.body_html?.replace(/<[^>]+>/g, '') || '',
    price: product.variants?.[0]?.price || '0.00',
    tags: product.tags?.split(',').map(tag => tag.trim()) || [],
    images: product.images?.map(img => img.src) || [],
    available: product.status === 'active',
  };
}
