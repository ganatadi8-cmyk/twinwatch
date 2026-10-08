/** Use the incoming host because Next.js can normalise request.url to localhost. */
export function isSameOriginRequest(request: Request): boolean {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
  const origin = request.headers.get('origin');
  if (!origin) return true;
  const requestUrl = new URL(request.url);
  const host = request.headers.get('host') ?? requestUrl.host;
  const protocol = request.headers.get('x-forwarded-proto') ?? requestUrl.protocol.slice(0, -1);
  if (protocol !== 'http' && protocol !== 'https') return false;
  return origin === `${protocol}://${host}`;
}
