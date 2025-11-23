// frontend/src/components/AIEOScoreCard.jsx
import React, { useMemo } from 'react';
import {
  Card,
  Box,
  Text,
  BlockStack,
  InlineStack,
  Divider,
  ProgressBar,
  Banner
} from '@shopify/polaris';

// Map technical endpoint keys to public display names (constant, outside component)
const endpointDisplayNames = {
  productsJson: 'Products JSON Feed',
  basicSitemap: 'Basic Sitemap',
  robotsTxt: 'robots.txt.liquid',
  schemaData: 'Schema Data (theme.liquid)',
  welcomePage: 'AI Welcome Page',
  collectionsJson: 'Collections JSON Feed',
  storeMetadata: 'Store Metadata',
  aiSitemap: 'AI-Enhanced Sitemap',
  advancedSchemaApi: 'Advanced Schema Data'
};

export default function AIEOScoreCard({ 
  testResults = {}, 
  aiTestResults = {}, 
  stats = {} 
}) {

  // Function to interpolate color from red to green based on score (0-100)
  const getScoreColor = (score) => {
    // Clamp score between 0 and 100
    const normalizedScore = Math.max(0, Math.min(100, score)) / 100;
    
    // Red: #ef4444 = rgb(239, 68, 68)
    // Green: #10b981 = rgb(16, 185, 129)
    const redStart = 239;
    const greenStart = 68;
    const blueStart = 68;
    
    const redEnd = 16;
    const greenEnd = 185;
    const blueEnd = 129;
    
    // Interpolate between start and end colors
    const red = Math.round(redStart + (redEnd - redStart) * normalizedScore);
    const green = Math.round(greenStart + (greenEnd - greenStart) * normalizedScore);
    const blue = Math.round(blueStart + (blueEnd - blueStart) * normalizedScore);
    
    return `rgb(${red}, ${green}, ${blue})`;
  };

  // Function to generate smooth gradient for donut chart (scaled based on score)
  const getDonutGradient = (score) => {
    // The gradient should scale based on score:
    // - 0-20%: only red
    // - 20-40%: red -> orange
    // - 40-60%: red -> orange -> yellow
    // - 60-80%: red -> orange -> yellow -> light green
    // - 80-100%: red -> orange -> yellow -> green
    const scoreDeg = score * 3.6; // Convert score (0-100) to degrees (0-360)
    const normalizedScore = Math.max(0, Math.min(100, score)) / 100;
    
    // Color stops based on score percentage
    let gradientStops = [];
    
    if (normalizedScore <= 0.2) {
      // 0-20%: Only red
      gradientStops = [
        `#ef4444 0deg`,
        `#ef4444 ${scoreDeg}deg`,
        `#e5e7eb ${scoreDeg}deg`,
        `#e5e7eb 360deg`
      ];
    } else if (normalizedScore <= 0.4) {
      // 20-40%: Red -> Orange
      const orangeStop = scoreDeg * 0.5; // Orange appears at midpoint
      gradientStops = [
        `#ef4444 0deg`,
        `#f97316 ${orangeStop}deg`,
        `#f97316 ${scoreDeg}deg`,
        `#e5e7eb ${scoreDeg}deg`,
        `#e5e7eb 360deg`
      ];
    } else if (normalizedScore <= 0.6) {
      // 40-60%: Red -> Orange -> Yellow (NO GREEN)
      const orangeStop = scoreDeg * 0.33;
      const yellowStop = scoreDeg * 0.66;
      gradientStops = [
        `#ef4444 0deg`,
        `#f97316 ${orangeStop}deg`,
        `#f59e0b ${yellowStop}deg`,
        `#f59e0b ${scoreDeg}deg`,
        `#e5e7eb ${scoreDeg}deg`,
        `#e5e7eb 360deg`
      ];
    } else if (normalizedScore <= 0.8) {
      // 60-80%: Red -> Orange -> Yellow -> Light Green (green starts at 60%)
      const orangeStop = scoreDeg * 0.2;
      const yellowStop = scoreDeg * 0.4;
      // Green starts at 60% of the filled portion, which is at 60% of total score
      const greenStartDeg = 60 * 3.6; // 60% = 216deg
      const lightGreenStop = Math.max(greenStartDeg, scoreDeg * 0.7);
      gradientStops = [
        `#ef4444 0deg`,
        `#f97316 ${orangeStop}deg`,
        `#f59e0b ${yellowStop}deg`,
        `#22c55e ${lightGreenStop}deg`, // Light green starts after 60%
        `#22c55e ${scoreDeg}deg`,
        `#e5e7eb ${scoreDeg}deg`,
        `#e5e7eb 360deg`
      ];
    } else {
      // 80-100%: Red -> Orange -> Yellow -> Green
      const orangeStop = scoreDeg * 0.15;
      const yellowStop = scoreDeg * 0.3;
      // Green starts at 60% of total (216deg)
      const greenStartDeg = 60 * 3.6; // 60% = 216deg
      const greenStop = Math.max(greenStartDeg, scoreDeg * 0.5);
      gradientStops = [
        `#ef4444 0deg`,
        `#f97316 ${orangeStop}deg`,
        `#f59e0b ${yellowStop}deg`,
        `#10b981 ${greenStop}deg`,
        `#10b981 ${scoreDeg}deg`,
        `#e5e7eb ${scoreDeg}deg`,
        `#e5e7eb 360deg`
      ];
    }
    
    return `conic-gradient(${gradientStops.join(', ')})`;
  };

  // Calculate AIEO Score based on test results, AI validation, and stats
  const calculatedAIEOScore = useMemo(() => {
    const calculateScore = (endpointResults, aiValidationResults, stats, endpointDisplayNames) => {
      const scoreBreakdown = {
        endpointAvailability: 0,
        aiValidationQuality: 0,
        optimizationCoverage: 0,
        structuredDataQuality: 0,
        total: 0
      };

      // Endpoint weights
      const endpointWeights = {
        productsJson: 5,
        basicSitemap: 4,
        robotsTxt: 2,
        schemaData: 2,
        welcomePage: 3,
        collectionsJson: 4,
        storeMetadata: 4,
        aiSitemap: 3,
        advancedSchemaApi: 3
      };

      // 1. ENDPOINT AVAILABILITY (0-30 points)
      let endpointPoints = 0;
      let totalEndpointWeight = 0;

      for (const [key, result] of Object.entries(endpointResults || {})) {
        const weight = endpointWeights[key] || 1;
        totalEndpointWeight += weight;

        if (result.status === 'success') {
          endpointPoints += weight;
        } else if (result.status === 'warning') {
          endpointPoints += weight * 0.7;
        } else if (result.status === 'locked') {
          endpointPoints += weight * 0.3;
        }
      }

      scoreBreakdown.endpointAvailability = totalEndpointWeight > 0
        ? Math.round((endpointPoints / totalEndpointWeight) * 30)
        : 0;

      // 2. AI VALIDATION QUALITY (0-40 points)
      const ratingScores = {
        'excellent': 1.0,
        'good': 0.75,
        'fair': 0.5,
        'poor': 0.25,
        'unavailable': 0,
        'locked': 0.1
      };

      let validationPoints = 0;
      let validationCount = 0;

      for (const [key, result] of Object.entries(aiValidationResults || {})) {
        if (key === 'robotsTxt' || key === 'schemaData') continue;

        const rating = result.rating?.toLowerCase() || 'unavailable';
        const score = ratingScores[rating] || 0;
        const weight = endpointWeights[key] || 1;
        validationPoints += score * weight;
        validationCount += weight;
      }

      scoreBreakdown.aiValidationQuality = validationCount > 0
        ? Math.round((validationPoints / validationCount) * 40)
        : 0;

      // 3. OPTIMIZATION COVERAGE (0-20 points)
      const totalProducts = stats.totalProducts || 0;
      const optimizedProducts = stats.optimizedProducts || 0;
      const totalCollections = stats.totalCollections || 0;
      const optimizedCollections = stats.optimizedCollections || 0;

      let coverageScore = 0;

      if (totalProducts > 0) {
        const productCoverage = optimizedProducts / totalProducts;
        coverageScore += productCoverage * 12;
      }

      if (totalCollections > 0) {
        const collectionCoverage = optimizedCollections / totalCollections;
        coverageScore += collectionCoverage * 8;
      } else if (totalProducts > 0) {
        coverageScore += 8;
      }

      scoreBreakdown.optimizationCoverage = Math.round(coverageScore);

      // 4. STRUCTURED DATA QUALITY (0-10 points)
      let structuredDataScore = 0;

      if (endpointResults?.schemaData?.status === 'success') {
        structuredDataScore += 3;
      }

      if (endpointResults?.storeMetadata?.status === 'success') {
        structuredDataScore += 3;
        const metadataRating = aiValidationResults?.storeMetadata?.rating?.toLowerCase();
        if (metadataRating === 'excellent') {
          structuredDataScore += 4;
        } else if (metadataRating === 'good') {
          structuredDataScore += 2;
        }
      } else if (endpointResults?.storeMetadata?.status === 'locked') {
        structuredDataScore += 1;
      }

      if (endpointResults?.advancedSchemaApi?.status === 'success') {
        structuredDataScore += 2;
      }

      scoreBreakdown.structuredDataQuality = Math.min(10, Math.round(structuredDataScore));

      // Calculate total score
      scoreBreakdown.total = Math.min(100,
        scoreBreakdown.endpointAvailability +
        scoreBreakdown.aiValidationQuality +
        scoreBreakdown.optimizationCoverage +
        scoreBreakdown.structuredDataQuality
      );

      // Determine grade (5-point scale: A=80-100%, B=60-79%, C=40-59%, D=20-39%, E=0-19%)
      let grade = 'E';
      let gradeColor = '#ef4444';

      if (scoreBreakdown.total >= 80) {
        grade = 'A';
        gradeColor = '#10b981';
      } else if (scoreBreakdown.total >= 60) {
        grade = 'B';
        gradeColor = '#3b82f6';
      } else if (scoreBreakdown.total >= 40) {
        grade = 'C';
        gradeColor = '#f59e0b';
      } else if (scoreBreakdown.total >= 20) {
        grade = 'D';
        gradeColor = '#f97316';
      }
      // E is for 0-19%

      // Generate recommendations
      const recommendations = [];
      if (scoreBreakdown.endpointAvailability < 20) {
        // Check if there are locked endpoints vs error/failed endpoints
        const lockedEndpoints = Object.entries(endpointResults || {})
          .filter(([key, result]) => result.status === 'locked')
          .length;
        const errorEndpoints = Object.entries(endpointResults || {})
          .filter(([key, result]) => result.status === 'error' || result.status === 'failed')
          .length;
        
        if (lockedEndpoints > 0 && errorEndpoints === 0) {
          // All missing are locked
          recommendations.push('Several AI discovery endpoints are locked due to plan limitations. Upgrade your plan to unlock them.');
        } else if (lockedEndpoints > 0 && errorEndpoints > 0) {
          // Mix of locked and errors
          recommendations.push('Some endpoints are missing or not working. Others are locked due to plan limitations. Fix endpoint issues and upgrade your plan to improve your score.');
        } else {
          // Only errors, no locked
          recommendations.push('Several AI discovery endpoints are missing or not working. Fix endpoint issues to improve your score.');
        }
      }
      if (scoreBreakdown.aiValidationQuality < 30) {
        const poorRatings = Object.entries(aiValidationResults || {})
          .filter(([key, result]) => {
            const rating = result.rating?.toLowerCase();
            return (rating === 'poor' || rating === 'fair') && key !== 'robotsTxt' && key !== 'schemaData';
          })
          .map(([key]) => endpointDisplayNames[key] || key);
        if (poorRatings.length > 0) {
          recommendations.push(`${poorRatings.length} endpoint(s) have low data quality ratings. Improve content quality to boost your score.`);
          recommendations.push(`Review and improve: ${poorRatings.join(', ')}`);
        }
      }
      if (scoreBreakdown.optimizationCoverage < 15) {
        recommendations.push('Low optimization coverage. Optimize more products and collections to improve your score.');
        recommendations.push('Go to Search Optimization for AI and optimize your products/collections');
      }
      if (scoreBreakdown.structuredDataQuality < 7) {
        recommendations.push('Structured data could be improved. Add organization schema and enhance product schema.');
      }

      return {
        score: scoreBreakdown.total,
        grade,
        gradeColor,
        breakdown: scoreBreakdown,
        recommendations: recommendations.length > 0 ? recommendations : ['Your store is well-optimized for AI search engines!']
      };
    };

    return calculateScore(testResults, aiTestResults, stats, endpointDisplayNames);
  }, [testResults, aiTestResults, stats]);

  // Safety check - ensure calculatedAIEOScore exists
  if (!calculatedAIEOScore) {
    console.error('[AIEOScoreCard] calculatedAIEOScore is null/undefined');
    return null;
  }

  console.log('[AIEOScoreCard] Rendering with score:', calculatedAIEOScore.score);

  return (
    <Card>
      <Box padding="400">
        <BlockStack gap="300">
          <BlockStack gap="100">
            <Text as="h3" variant="headingMd">AIEO Score</Text>
            <Text variant="bodySm" tone="subdued">
              Overall AI Engine Optimization rating
            </Text>
          </BlockStack>
          
          <Divider />
          
          {/* Two-column layout: Donut Chart with Score (left) and Score Breakdown (right) */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
            {/* Left Column: Donut Chart + Score Text */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
              {/* Donut Chart (with white circle inside) - 15% larger */}
              <Box
                style={{
                  width: '138px', // 120px * 1.15 = 138px
                  height: '138px',
                  borderRadius: '50%',
                  background: getDonutGradient(calculatedAIEOScore.score),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  position: 'relative',
                  flexShrink: 0
                }}
              >
                {/* White inner circle for donut effect - scaled proportionally */}
                <Box
                  style={{
                    width: '103.5px', // 90px * 1.15 = 103.5px
                    height: '103.5px',
                    borderRadius: '50%',
                    background: 'white',
                    position: 'absolute',
                    zIndex: 1
                  }}
                />
              </Box>
              
              {/* Score Text (to the right of donut chart) */}
              <BlockStack gap="100">
                <Text variant="headingMd" fontWeight="semibold" style={{ color: getScoreColor(calculatedAIEOScore.score) }}>
                  AIEO Score = {calculatedAIEOScore.score}
                </Text>
                <Text variant="headingMd" fontWeight="bold" style={{ color: getScoreColor(calculatedAIEOScore.score) }}>
                  AIEO Rating = {calculatedAIEOScore.grade}
                </Text>
              </BlockStack>
            </div>
            
            {/* Right Column: Score Breakdown */}
            <BlockStack gap="200">
              <Text variant="headingSm">Score Breakdown</Text>
              <BlockStack gap="100">
                <InlineStack align="space-between">
                  <Text variant="bodyMd">Endpoint Availability</Text>
                  <Text variant="bodyMd" fontWeight="semibold">{calculatedAIEOScore.breakdown.endpointAvailability}/30</Text>
                </InlineStack>
                <ProgressBar progress={Math.round((calculatedAIEOScore.breakdown.endpointAvailability / 30) * 100)} size="small" tone="success" />
              </BlockStack>
              <BlockStack gap="100">
                <InlineStack align="space-between">
                  <Text variant="bodyMd">AI Validation Quality</Text>
                  <Text variant="bodyMd" fontWeight="semibold">{calculatedAIEOScore.breakdown.aiValidationQuality}/40</Text>
                </InlineStack>
                <ProgressBar progress={Math.round((calculatedAIEOScore.breakdown.aiValidationQuality / 40) * 100)} size="small" tone="success" />
              </BlockStack>
              <BlockStack gap="100">
                <InlineStack align="space-between">
                  <Text variant="bodyMd">Optimization Coverage</Text>
                  <Text variant="bodyMd" fontWeight="semibold">{calculatedAIEOScore.breakdown.optimizationCoverage}/20</Text>
                </InlineStack>
                <ProgressBar progress={Math.round((calculatedAIEOScore.breakdown.optimizationCoverage / 20) * 100)} size="small" tone="success" />
              </BlockStack>
              <BlockStack gap="100">
                <InlineStack align="space-between">
                  <Text variant="bodyMd">Structured Data Quality</Text>
                  <Text variant="bodyMd" fontWeight="semibold">{calculatedAIEOScore.breakdown.structuredDataQuality}/10</Text>
                </InlineStack>
                <ProgressBar progress={Math.round((calculatedAIEOScore.breakdown.structuredDataQuality / 10) * 100)} size="small" tone="success" />
              </BlockStack>
            </BlockStack>
          </div>

          {calculatedAIEOScore.recommendations && calculatedAIEOScore.recommendations.length > 0 && (
            <>
              <Divider />
              <BlockStack gap="200">
                <Text variant="headingSm">Recommendations</Text>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  {calculatedAIEOScore.recommendations.map((rec, idx) => (
                    <Banner 
                      key={idx} 
                      tone={rec.includes('Fix') || rec.includes('Improve') || rec.includes('low') ? 'critical' : 
                            rec.includes('Review') ? 'warning' : 'info'}
                    >
                      <Text variant="bodyMd">{rec}</Text>
                    </Banner>
                  ))}
                </div>
              </BlockStack>
            </>
          )}
        </BlockStack>
      </Box>
    </Card>
  );
}

