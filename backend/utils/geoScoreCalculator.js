/**
 * AIEO Score Calculator
 * Calculates overall AI Engine Optimization score (0-100) based on:
 * - Endpoint availability and functionality
 * - AI validation ratings
 * - Data optimization coverage
 * - Structured data quality
 */

/**
 * Calculate overall AIEO score from test results
 * @param {Object} endpointResults - Results from /api/ai-testing/run-tests
 * @param {Object} aiValidationResults - Results from /api/ai-testing/ai-validate
 * @param {Object} stats - Store statistics (products, collections, etc.)
 * @returns {Object} Score breakdown and overall score
 */
export function calculateAIEOScore(endpointResults, aiValidationResults, stats = {}) {
  const scoreBreakdown = {
    endpointAvailability: 0,      // 0-30 points
    aiValidationQuality: 0,        // 0-40 points
    optimizationCoverage: 0,       // 0-20 points
    structuredDataQuality: 0,     // 0-10 points
    total: 0
  };

  // === 1. ENDPOINT AVAILABILITY (0-30 points) ===
  // Weight: 30% of total score
  const endpointWeights = {
    // Core endpoints (Starter plan) - Higher weight
    productsJson: 5,
    basicSitemap: 4,
    robotsTxt: 2,
    schemaData: 2,
    
    // Growth plan endpoints
    welcomePage: 3,
    collectionsJson: 4,
    
    // Growth Extra plan endpoints
    storeMetadata: 4,
    aiSitemap: 3,
    advancedSchemaApi: 3
  };

  let endpointPoints = 0;
  let totalEndpointWeight = 0;

  for (const [key, result] of Object.entries(endpointResults || {})) {
    const weight = endpointWeights[key] || 1;
    totalEndpointWeight += weight;

    if (result.status === 'success') {
      endpointPoints += weight; // Full points
    } else if (result.status === 'warning') {
      endpointPoints += weight * 0.7; // 70% points (working but needs attention)
    } else if (result.status === 'locked') {
      endpointPoints += weight * 0.3; // 30% points (plan limitation, not a failure)
    } else if (result.status === 'error' || result.status === 'failed') {
      endpointPoints += 0; // No points
    }
  }

  scoreBreakdown.endpointAvailability = totalEndpointWeight > 0
    ? Math.round((endpointPoints / totalEndpointWeight) * 30)
    : 0;

  // === 2. AI VALIDATION QUALITY (0-40 points) ===
  // Weight: 40% of total score
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
    // Skip theme files (robotsTxt, schemaData) - they're not API endpoints
    if (key === 'robotsTxt' || key === 'schemaData') {
      continue;
    }

    const rating = result.rating?.toLowerCase() || 'unavailable';
    const score = ratingScores[rating] || 0;
    
    // Weight by endpoint importance
    const weight = endpointWeights[key] || 1;
    validationPoints += score * weight;
    validationCount += weight;
  }

  scoreBreakdown.aiValidationQuality = validationCount > 0
    ? Math.round((validationPoints / validationCount) * 40)
    : 0;

  // === 3. OPTIMIZATION COVERAGE (0-20 points) ===
  // Weight: 20% of total score
  const totalProducts = stats.totalProducts || 0;
  const optimizedProducts = stats.optimizedProducts || 0;
  const totalCollections = stats.totalCollections || 0;
  const optimizedCollections = stats.optimizedCollections || 0;

  let coverageScore = 0;

  // Products optimization (60% of coverage score)
  if (totalProducts > 0) {
    const productCoverage = optimizedProducts / totalProducts;
    coverageScore += productCoverage * 12; // Max 12 points
  } else {
    // No products = no points for this part
  }

  // Collections optimization (40% of coverage score)
  if (totalCollections > 0) {
    const collectionCoverage = optimizedCollections / totalCollections;
    coverageScore += collectionCoverage * 8; // Max 8 points
  } else if (totalProducts > 0) {
    // If no collections but has products, give full points for collections part
    coverageScore += 8;
  }

  scoreBreakdown.optimizationCoverage = Math.round(coverageScore);

  // === 4. STRUCTURED DATA QUALITY (0-10 points) ===
  // Weight: 10% of total score
  let structuredDataScore = 0;

  // Check schemaData endpoint
  if (endpointResults?.schemaData?.status === 'success') {
    structuredDataScore += 3; // Basic schema present
  }

  // Check storeMetadata (Organization Schema)
  if (endpointResults?.storeMetadata?.status === 'success') {
    structuredDataScore += 3; // Organization schema present
    
    // If AI validation says it's excellent/good, add bonus
    const metadataRating = aiValidationResults?.storeMetadata?.rating?.toLowerCase();
    if (metadataRating === 'excellent') {
      structuredDataScore += 4; // Bonus for quality
    } else if (metadataRating === 'good') {
      structuredDataScore += 2;
    }
  } else if (endpointResults?.storeMetadata?.status === 'locked') {
    structuredDataScore += 1; // Partial credit for plan limitation
  }

  // Check advancedSchemaApi
  if (endpointResults?.advancedSchemaApi?.status === 'success') {
    structuredDataScore += 2; // Advanced schema present
  }

  scoreBreakdown.structuredDataQuality = Math.min(10, Math.round(structuredDataScore));

  // === CALCULATE TOTAL SCORE ===
  scoreBreakdown.total = Math.min(100, 
    scoreBreakdown.endpointAvailability +
    scoreBreakdown.aiValidationQuality +
    scoreBreakdown.optimizationCoverage +
    scoreBreakdown.structuredDataQuality
  );

  // === DETERMINE GRADE ===
  let grade = 'F';
  let gradeColor = '#ef4444'; // red
  
  if (scoreBreakdown.total >= 90) {
    grade = 'A+';
    gradeColor = '#10b981'; // green
  } else if (scoreBreakdown.total >= 80) {
    grade = 'A';
    gradeColor = '#10b981'; // green
  } else if (scoreBreakdown.total >= 70) {
    grade = 'B';
    gradeColor = '#3b82f6'; // blue
  } else if (scoreBreakdown.total >= 60) {
    grade = 'C';
    gradeColor = '#f59e0b'; // orange
  } else if (scoreBreakdown.total >= 50) {
    grade = 'D';
    gradeColor = '#f97316'; // orange-red
  }

  return {
    score: scoreBreakdown.total,
    grade,
    gradeColor,
    breakdown: scoreBreakdown,
    recommendations: generateRecommendations(scoreBreakdown, endpointResults, aiValidationResults)
  };
}

/**
 * Generate recommendations based on score breakdown
 */
function generateRecommendations(breakdown, endpointResults, aiValidationResults) {
  const recommendations = [];

  // Endpoint availability recommendations
  if (breakdown.endpointAvailability < 20) {
    recommendations.push({
      category: 'endpoints',
      priority: 'high',
      message: 'Several AI discovery endpoints are missing or not working. Fix endpoint issues to improve your score.',
      action: 'Run basic tests and fix any failed endpoints'
    });
  }

  // AI validation quality recommendations
  if (breakdown.aiValidationQuality < 30) {
    const poorRatings = Object.entries(aiValidationResults || {})
      .filter(([key, result]) => {
        const rating = result.rating?.toLowerCase();
        return rating === 'poor' || rating === 'fair';
      })
      .map(([key]) => key);

    if (poorRatings.length > 0) {
      recommendations.push({
        category: 'quality',
        priority: 'high',
        message: `${poorRatings.length} endpoint(s) have low data quality ratings. Improve content quality to boost your score.`,
        action: `Review and improve: ${poorRatings.join(', ')}`
      });
    }
  }

  // Optimization coverage recommendations
  if (breakdown.optimizationCoverage < 15) {
    recommendations.push({
      category: 'coverage',
      priority: 'medium',
      message: 'Low optimization coverage. Optimize more products and collections to improve your score.',
      action: 'Go to Search Optimization for AI and optimize your products/collections'
    });
  }

  // Structured data recommendations
  if (breakdown.structuredDataQuality < 7) {
    recommendations.push({
      category: 'structured-data',
      priority: 'medium',
      message: 'Structured data could be improved. Add organization schema and enhance product schema.',
      action: 'Configure store metadata and enable advanced schema features'
    });
  }

  return recommendations;
}

/**
 * Get score interpretation
 */
export function getScoreInterpretation(score) {
  if (score >= 90) {
    return {
      level: 'Excellent',
      description: 'Your store is highly optimized for AI search engines. Excellent structured data and content quality.',
      color: '#10b981'
    };
  } else if (score >= 80) {
    return {
      level: 'Very Good',
      description: 'Your store is well-optimized for AI search. Minor improvements could push you to excellent.',
      color: '#10b981'
    };
  } else if (score >= 70) {
    return {
      level: 'Good',
      description: 'Your store has good AI optimization. Focus on improving data quality and coverage.',
      color: '#3b82f6'
    };
  } else if (score >= 60) {
    return {
      level: 'Fair',
      description: 'Your store has basic AI optimization. Several areas need improvement.',
      color: '#f59e0b'
    };
  } else if (score >= 50) {
    return {
      level: 'Needs Improvement',
      description: 'Your store needs significant optimization for AI search engines.',
      color: '#f97316'
    };
  } else {
    return {
      level: 'Poor',
      description: 'Your store is not optimized for AI search. Immediate action required.',
      color: '#ef4444'
    };
  }
}

