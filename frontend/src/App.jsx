import React from 'react';

export default function App() {
  return (
    <div style={{ padding: '20px', backgroundColor: '#f4f4f4', minHeight: '500px' }}>
      <h1>NEW AI SEO - Test</h1>
      <p>If you see this, the app is working!</p>
      <p>Current URL: {window.location.href}</p>
      <p>Time: {new Date().toLocaleString()}</p>
    </div>
  );
}