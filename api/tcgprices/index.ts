import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Vercel Serverless Proxy for TCGCSV.com — TCGPlayer price data.
 *
 * Fetches product info and market prices for a TCGPlayer group (= Pokemon set),
 * joins them by productId, and returns a merged response.
 *
 * TCGCSV.com mirrors TCGPlayer's official API data daily — no API key needed.
 *
 * Route: /api/tcgprices?groupId=3170
 *   → fetches https://tcgcsv.com/tcgplayer/3/{groupId}/products
 *   → fetches https://tcgcsv.com/tcgplayer/3/{groupId}/prices
 *   → returns merged { products, prices } with 6h edge cache
 */

const TCGCSV_BASE = 'https://tcgcsv.com/tcgplayer/3';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const groupId = req.query.groupId;
    if (!groupId || Array.isArray(groupId)) {
        return res.status(400).json({ error: 'Missing or invalid groupId parameter' });
    }

    // Validate groupId is a number
    if (!/^\d+$/.test(groupId)) {
        return res.status(400).json({ error: 'groupId must be a number' });
    }

    try {
        // Fetch products and prices in parallel
        const [productsRes, pricesRes] = await Promise.all([
            fetch(`${TCGCSV_BASE}/${groupId}/products`),
            fetch(`${TCGCSV_BASE}/${groupId}/prices`),
        ]);

        if (!productsRes.ok || !pricesRes.ok) {
            return res.status(502).json({
                error: 'TCGCSV upstream error',
                productsStatus: productsRes.status,
                pricesStatus: pricesRes.status,
            });
        }

        const [productsJson, pricesJson] = await Promise.all([
            productsRes.json(),
            pricesRes.json(),
        ]);

        // Cache for 6 hours at the Vercel edge, stale-while-revalidate for 1 hour
        res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=3600');
        res.setHeader('Content-Type', 'application/json');

        res.status(200).json({
            success: true,
            groupId: Number(groupId),
            products: productsJson.results || [],
            prices: pricesJson.results || [],
        });
    } catch (err: any) {
        console.error('[TCGPrices] Fetch failed:', err?.message);
        res.status(502).json({ error: 'TCGCSV unreachable', details: err?.message });
    }
}
