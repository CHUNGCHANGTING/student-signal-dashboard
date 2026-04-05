// ev-signals-update: store new signals from 正EV推播
const body = $input.first().json.body || $input.first().json;

const staticData = $getWorkflowStaticData('global');
staticData.latestSignals = {
  timestamp: body.timestamp || new Date().toISOString(),
  signals: body.signals || [],
  summary: body.summary || {},
  raw: body.raw || [],
};

return [{ json: { status: 'ok', stored: (body.signals || []).length, timestamp: new Date().toISOString() } }];
