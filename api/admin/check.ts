// api/admin/check.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

function readAuthHeader(req: VercelRequest): string {
  const raw =
    (req.headers['authorization'] as string | string[] | undefined) ??
    (req.headers['Authorization'] as string | string[] | undefined) ??
    '';
  const val = Array.isArray(raw) ? raw[0] : raw;
  return typeof val === 'string' ? val : '';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const hdr = readAuthHeader(req);
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7).trim() : '';
  const need = (process.env.ADMIN_TOKEN || process.env.ADMIN_SECRET || '').trim();

  if (!need) return res.status(500).json({ error: 'Server missing ADMIN_TOKEN' });
  if (!token || token !== need) return res.status(401).json({ ok: false });

  return res.status(200).json({ ok: true });
}
