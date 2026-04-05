// ev-signals webhook: return latest EV signals
const staticData = $getWorkflowStaticData('global');
const signals = staticData.latestSignals || { timestamp: null, signals: [], summary: { symbolCount: 0, totalSignals: 0 } };

// Add CORS headers
return [{
  json: {
    ...signals,
    _served_at: new Date().toISOString(),
    _endpoint: 'ev-signals'
  }
}];
