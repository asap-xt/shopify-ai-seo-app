// backend/controllers/testController.js
import express from 'express';
import mongoose from 'mongoose';

const router = express.Router();

// Store test plan overrides in memory (resets on restart)
const testPlanOverrides = new Map();

// Set test plan for a shop
router.post('/test/set-plan', async (req, res) => {
  try {
    const { shop, plan } = req.body;
    
    if (!shop || !plan) {
      return res.status(400).json({ error: 'Missing shop or plan' });
    }
    
    const validPlans = ['starter', 'professional', 'growth', 'growth_extra', 'enterprise'];
    if (!validPlans.includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan' });
    }
    
    // Store in memory
    testPlanOverrides.set(shop, plan);
    
    // If MongoDB is available, store in database too
    if (mongoose.connection.readyState === 1) {
      try {
        const TestPlan = mongoose.models.TestPlan || mongoose.model('TestPlan', new mongoose.Schema({
          shop: String,
          plan: String,
          createdAt: { type: Date, default: Date.now }
        }));
        
        await TestPlan.findOneAndUpdate(
          { shop },
          { shop, plan },
          { upsert: true, new: true }
        );
      } catch (err) {
        console.log('Could not save to DB, using memory only');
      }
    }
    
    res.json({
      ok: true,
      shop,
      plan,
      message: 'Test plan updated successfully'
    });
    
  } catch (error) {
    console.error('Error setting test plan:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get current test plan override
router.get('/test/get-plan', async (req, res) => {
  try {
    const shop = req.query.shop;
    if (!shop) {
      return res.status(400).json({ error: 'Missing shop' });
    }
    
    // Check memory first
    const memoryPlan = testPlanOverrides.get(shop);
    if (memoryPlan) {
      return res.json({ plan: memoryPlan, source: 'memory' });
    }
    
    // Check database if available
    if (mongoose.connection.readyState === 1) {
      try {
        const TestPlan = mongoose.models.TestPlan || mongoose.model('TestPlan', new mongoose.Schema({
          shop: String,
          plan: String,
          createdAt: { type: Date, default: Date.now }
        }));
        
        const doc = await TestPlan.findOne({ shop });
        if (doc) {
          testPlanOverrides.set(shop, doc.plan); // Cache in memory
          return res.json({ plan: doc.plan, source: 'database' });
        }
      } catch (err) {
        console.log('Could not read from DB');
      }
    }
    
    res.json({ plan: null, source: 'none' });
    
  } catch (error) {
    console.error('Error getting test plan:', error);
    res.status(500).json({ error: error.message });
  }
});

// Export function to check test plan override
export function getTestPlanOverride(shop) {
  return testPlanOverrides.get(shop) || null;
}

export default router;