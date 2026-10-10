export default function handler(_request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.status(200).json({
    status: 'ok',
    service: 'mentoro-api',
    stage: 'foundation',
    note: 'Database and authentication integrations are not enabled yet.'
  });
}
