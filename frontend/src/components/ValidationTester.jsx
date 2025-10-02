// Validation Tester Component for testing AI validation in real conditions
import React, { useState, useMemo } from 'react';
import {
  Card,
  FormLayout,
  TextField,
  Button,
  Text,
  Banner,
  List,
  Badge,
  Divider,
  Collapsible,
  BlockStack,
  InlineStack
} from '@shopify/polaris';
import { makeSessionFetch } from '../lib/sessionFetch.js';

const ValidationTester = ({ shop }) => {
  // API helper
  const api = useMemo(() => makeSessionFetch(), []);
  
  const [productData, setProductData] = useState({
    title: "Premium Wireless Headphones",
    description: "High-quality wireless headphones with noise cancellation, perfect for music lovers and professionals. Features Bluetooth connectivity and long battery life.",
    tags: ["wireless", "bluetooth", "noise-cancelling", "premium", "electronics"],
    productType: "Electronics",
    vendor: "TechBrand"
  });
  
  const [aiResponse, setAiResponse] = useState({
    bullets: [
      "Premium wireless headphones with noise cancellation",
      "Bluetooth connectivity for seamless pairing",
      "Long battery life up to 30 hours",
      "Made with premium materials",
      "ISO 9001 certified quality",
      "30-day money back guarantee",
      "Made in Germany with precision engineering",
      "Free shipping worldwide",
      "Perfect for music lovers and professionals"
    ],
    faq: [
      {
        q: "How long is the battery life?",
        a: "These headphones offer long battery life for extended use."
      },
      {
        q: "What connectivity options are available?",
        a: "The headphones feature Bluetooth connectivity for wireless pairing."
      },
      {
        q: "What is your return policy?",
        a: "We offer 30-day money back guarantee on all products."
      },
      {
        q: "Where are these headphones made?",
        a: "Made in Germany with precision engineering and ISO certification."
      }
    ]
  });
  
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);

  const handleTestValidation = async () => {
    setLoading(true);
    try {
      const data = await api('/test/test-validation', {
        method: 'POST',
        body: {
          productData,
          aiResponse,
          requestedAttributes: ['bullets', 'faq', 'attributes']
        }
      });
      
      setResults(data);
      setShowResults(true);
    } catch (error) {
      console.error('Validation test failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleTestExtraction = async () => {
    setLoading(true);
    try {
      const data = await api('/test/test-extraction', {
        method: 'POST',
        body: {
          productData,
          requestedAttributes: ['material', 'color', 'size', 'category', 'audience']
        }
      });
      
      setResults({ ...results, extraction: data });
    } catch (error) {
      console.error('Extraction test failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const getValidationStatus = (original, validated) => {
    const rejected = original - validated;
    if (rejected === 0) return { status: 'success', text: 'All passed' };
    if (rejected === original) return { status: 'critical', text: 'All rejected' };
    return { status: 'warning', text: `${rejected} rejected` };
  };

  return (
    <Card>
      <BlockStack gap="400">
        <Text variant="headingLg">🧪 AI Validation Tester</Text>
        
        <Banner status="info">
          Test AI validation with real product data. This will show you how the validation system 
          filters out hallucinations and preserves factual content.
        </Banner>

        <FormLayout>
          <TextField
            label="Product Title"
            value={productData.title}
            onChange={(value) => setProductData(prev => ({ ...prev, title: value }))}
          />
          
          <TextField
            label="Product Description"
            value={productData.description}
            onChange={(value) => setProductData(prev => ({ ...prev, description: value }))}
            multiline={3}
          />
          
          <TextField
            label="Product Tags (comma-separated)"
            value={productData.tags.join(', ')}
            onChange={(value) => setProductData(prev => ({ 
              ...prev, 
              tags: value.split(',').map(tag => tag.trim()).filter(Boolean)
            }))}
          />
          
          <TextField
            label="Product Type"
            value={productData.productType}
            onChange={(value) => setProductData(prev => ({ ...prev, productType: value }))}
          />
          
          <TextField
            label="Vendor"
            value={productData.vendor}
            onChange={(value) => setProductData(prev => ({ ...prev, vendor: value }))}
          />
        </FormLayout>

        <Divider />

        <BlockStack align="space-between">
          <Button 
            primary 
            onClick={handleTestValidation}
            loading={loading}
          >
            Test Validation
          </Button>
          
          <Button 
            onClick={handleTestExtraction}
            loading={loading}
          >
            Test Attribute Extraction
          </Button>
        </BlockStack>

        {results && showResults && (
          <Collapsible
            open={showResults}
            id="validation-results"
            transition={{ duration: '200ms', timingFunction: 'ease-in-out' }}
          >
            <BlockStack  gap="400">
              <Divider />
              
              <Text variant="headingMd">📊 Validation Results</Text>
              
              <BlockStack align="space-between">
                <Card sectioned>
                  <BlockStack  gap="200">
                    <Text variant="headingSm">Bullets</Text>
                    <BlockStack align="space-between">
                      <Badge status={getValidationStatus(results.original.bullets, results.validated.bullets).status}>
                        {results.original.bullets} → {results.validated.bullets}
                      </Badge>
                      <Text variant="bodySm">
                        {results.rejected.bullets} rejected
                      </Text>
                    </BlockStack>
                  </BlockStack>
                </Card>
                
                <Card sectioned>
                  <BlockStack  gap="200">
                    <Text variant="headingSm">FAQ</Text>
                    <BlockStack align="space-between">
                      <Badge status={getValidationStatus(results.original.faq, results.validated.faq).status}>
                        {results.original.faq} → {results.validated.faq}
                      </Badge>
                      <Text variant="bodySm">
                        {results.rejected.faq} rejected
                      </Text>
                    </BlockStack>
                  </BlockStack>
                </Card>
              </BlockStack>

              {results.validatedContent && (
                <Card sectioned>
                  <BlockStack  gap="400">
                    <Text variant="headingSm">✅ Validated Content</Text>
                    
                    {results.validatedContent.bullets && results.validatedContent.bullets.length > 0 && (
                      <BlockStack  gap="200">
                        <Text variant="headingXs">Valid Bullets:</Text>
                        <List type="bullet">
                          {results.validatedContent.bullets.map((bullet, i) => (
                            <List.Item key={i}>{bullet}</List.Item>
                          ))}
                        </List>
                      </BlockStack>
                    )}
                    
                    {results.validatedContent.faq && results.validatedContent.faq.length > 0 && (
                      <BlockStack  gap="200">
                        <Text variant="headingXs">Valid FAQ:</Text>
                        {results.validatedContent.faq.map((faq, i) => (
                          <BlockStack  gap="200" key={i}>
                            <Text variant="bodySm" fontWeight="bold">Q: {faq.q}</Text>
                            <Text variant="bodySm">A: {faq.a}</Text>
                          </BlockStack>
                        ))}
                      </BlockStack>
                    )}
                  </BlockStack>
                </Card>
              )}

              {results.extractedAttributes && (
                <Card sectioned>
                  <BlockStack  gap="400">
                    <Text variant="headingSm">🔍 Extracted Attributes</Text>
                    <BlockStack align="space-between">
                      {Object.entries(results.extractedAttributes.extractedAttributes || {}).map(([key, value]) => (
                        <Badge key={key} status={value ? 'success' : 'info'}>
                          {key}: {value || 'Not found'}
                        </Badge>
                      ))}
                    </BlockStack>
                  </BlockStack>
                </Card>
              )}
            </BlockStack>
          </Collapsible>
        )}
      </BlockStack>
    </Card>
  );
};

export default ValidationTester;
