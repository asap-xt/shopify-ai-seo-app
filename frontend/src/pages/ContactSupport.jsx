// frontend/src/pages/ContactSupport.jsx
// Contact Support form using EmailJS
// 
// Environment Variables needed:
// EMAILJS_SERVICE_ID=service_c8j657n
// EMAILJS_TEMPLATE_ID=template_zrftkfg
// EMAILJS_PUBLIC_KEY=-0N7g1SCh9fSknb6q
// CONTACT_EMAIL=support@shopify-ai-seo.com

import { useState, useEffect } from 'react';
import {
  Card,
  Box,
  Text,
  TextField,
  Select,
  Button,
  BlockStack,
  InlineStack,
  Banner,
  Spinner
} from '@shopify/polaris';
import emailjs from '@emailjs/browser';
import { useShopApi } from '../hooks/useShopApi';

const SUBJECT_OPTIONS = [
  { label: 'Bug Report', value: 'bug_report' },
  { label: 'Feature Request', value: 'feature_request' },
  { label: 'Billing Issue', value: 'billing_issue' },
  { label: 'General Question', value: 'general_question' },
  { label: 'Technical Support', value: 'technical_support' }
];

export default function ContactSupport({ shop: shopProp }) {
  const { api } = useShopApi();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    subject: 'general_question',
    message: '',
    file: null
  });
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null); // 'success', 'error', null
  const [statusMessage, setStatusMessage] = useState('');
  const [shopInfo, setShopInfo] = useState(null);

  // Get shop from URL params if not provided as prop
  const qs = (k, d = '') => { 
    try { 
      return new URLSearchParams(window.location.search).get(k) || d; 
    } catch { 
      return d; 
    } 
  };
  const shop = shopProp || qs('shop', '');

  useEffect(() => {
    loadShopInfo();
  }, [shop]);

  const loadShopInfo = async () => {
    try {
      const data = await api(`/api/shop/info?shop=${encodeURIComponent(shop)}`);
      setShopInfo(data);
      
      // Auto-fill form with shop info
      setFormData(prev => ({
        ...prev,
        name: data?.name || '',
        email: data?.email || ''
      }));
    } catch (error) {
      console.error('[ContactSupport] Error loading shop info:', error);
    }
  };

  const handleInputChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleFileUpload = (files) => {
    if (files.length > 0) {
      const file = files[0];
      
      // Check file size (500KB limit)
      if (file.size > 500 * 1024) {
        setStatus('error');
        setStatusMessage('File size must be less than 500KB');
        return;
      }
      
      setFormData(prev => ({
        ...prev,
        file: file
      }));
    }
  };

  const convertFileToBase64 = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result);
      reader.onerror = error => reject(error);
    });
  };

  const validateForm = () => {
    if (!formData.name.trim()) {
      setStatus('error');
      setStatusMessage('Please enter your name');
      return false;
    }
    if (!formData.email.trim()) {
      setStatus('error');
      setStatusMessage('Please enter your email');
      return false;
    }
    if (!formData.message.trim()) {
      setStatus('error');
      setStatusMessage('Please enter your message');
      return false;
    }
    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    setLoading(true);
    setStatus(null);
    setStatusMessage('');

    try {
      // Prepare template parameters
      let templateParams = {
        name: formData.name,
        email: formData.email,
        subject: SUBJECT_OPTIONS.find(opt => opt.value === formData.subject)?.label || formData.subject,
        message: formData.message,
        shop_name: shopInfo?.name || shop,
        shop_url: `https://${shop}`,
        time: new Date().toLocaleString()
      };

      // Add file attachment if present
      if (formData.file) {
        try {
          const base64File = await convertFileToBase64(formData.file);
          templateParams.file_name = formData.file.name;
          templateParams.file_size = `${(formData.file.size / 1024).toFixed(1)} KB`;
          templateParams.file_type = formData.file.type;
          templateParams.file_data = base64File;
        } catch (error) {
          console.error('[ContactSupport] Error converting file to base64:', error);
          // Continue without file if conversion fails
          templateParams.message += `\n\n📎 ATTACHED FILE (conversion failed):\nName: ${formData.file.name}\nSize: ${(formData.file.size / 1024).toFixed(1)} KB\nType: ${formData.file.type}`;
        }
      }

      // Send email using EmailJS
      console.log('[ContactSupport] Sending email with params:', templateParams);
      
      const result = await emailjs.send(
        'service_c8j657n', // Service ID
        'template_zrftkfg', // Template ID
        templateParams,
        '-0N7g1SCh9fSknb6q' // Public Key
      );

      console.log('[ContactSupport] Email sent successfully:', result);
      
      setStatus('success');
      setStatusMessage('Message sent successfully! We\'ll get back to you within 24 hours.');
      
      // Reset form
      setFormData({
        name: shopInfo?.name || '',
        email: shopInfo?.email || '',
        subject: 'general_question',
        message: '',
        file: null
      });

    } catch (error) {
      console.error('[ContactSupport] Error sending email:', error);
      console.error('[ContactSupport] Error details:', {
        message: error.message,
        status: error.status,
        text: error.text,
        stack: error.stack
      });
      
      setStatus('error');
      setStatusMessage(`Failed to send message: ${error.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box padding="400">
      <BlockStack gap="400">
        <Text variant="bodyMd" tone="subdued">
          Need help? Send us a message and we'll get back to you within 24 hours.
        </Text>

        {status && (
          <Banner tone={status === 'success' ? 'success' : 'critical'}>
            {statusMessage}
          </Banner>
        )}

        <Card>
          <Box padding="400">
            <form onSubmit={handleSubmit}>
              <BlockStack gap="400">
                <InlineStack gap="400" wrap>
                  <Box flexGrow={1}>
                    <TextField
                      label="Name"
                      value={formData.name}
                      onChange={(value) => handleInputChange('name', value)}
                      placeholder="Your name"
                      required
                      disabled={loading}
                    />
                  </Box>
                  <Box flexGrow={1}>
                    <TextField
                      label="Email"
                      type="email"
                      value={formData.email}
                      onChange={(value) => handleInputChange('email', value)}
                      placeholder="your@email.com"
                      required
                      disabled={loading}
                    />
                  </Box>
                </InlineStack>

                <Select
                  label="Subject"
                  options={SUBJECT_OPTIONS}
                  value={formData.subject}
                  onChange={(value) => handleInputChange('subject', value)}
                  disabled={loading}
                />

                <TextField
                  label="Message"
                  value={formData.message}
                  onChange={(value) => handleInputChange('message', value)}
                  multiline={4}
                  placeholder="Describe your issue or question..."
                  required
                  disabled={loading}
                />

                <Box>
                  <Text as="label" variant="bodyMd" fontWeight="medium">
                    Attach File (Optional)
                  </Text>
                  <Box paddingBlockStart="100">
                    <input
                      type="file"
                      onChange={(e) => handleFileUpload(e.target.files)}
                      disabled={loading}
                      style={{
                        padding: '8px',
                        border: '1px solid #d1d5db',
                        borderRadius: '4px',
                        fontSize: '14px',
                        width: '100%'
                      }}
                    />
                  </Box>
                  <Text variant="bodySm" tone="subdued">
                    Any file type allowed • Maximum file size: 500KB
                  </Text>
                </Box>

                <InlineStack gap="200" align="end">
                  <Button
                    variant="primary"
                    submit
                    loading={loading}
                    disabled={loading}
                  >
                    {loading ? 'Sending...' : 'Send Message'}
                  </Button>
                </InlineStack>
              </BlockStack>
            </form>
          </Box>
        </Card>

        <Card>
          <Box padding="400">
            <BlockStack gap="200">
              <Text as="h3" variant="headingMd">
                Other Ways to Reach Us
              </Text>
              <Text variant="bodyMd" tone="subdued">
                • Email: indexaize@gmail.com
              </Text>
              <Text variant="bodyMd" tone="subdued">
                • Response time: Within 24 hours
              </Text>
              <Text variant="bodyMd" tone="subdued">
                • Include your shop name: {shop}
              </Text>
            </BlockStack>
          </Box>
        </Card>
      </BlockStack>
    </Box>
  );
}
