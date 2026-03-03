/**
 * Collection Sync — Persist card collections to Supabase.
 * Upserts cards (increments quantity for duplicates).
 * Supabase is always required — no guest fallback.
 */
import { supabase } from './supabase';
import type { PackCard } from './engine/pack-generator';

export interface CollectionCard {
    id: string;
    card_number: string;
    card_name: string;
    set_id: string;
    rarity: string;
    is_reverse_holo: boolean;
    is_gallery: boolean;
    image_small: string | null;
    image_large: string | null;
    market_price: number | null;
    quantity: number;
    first_pulled_at: string;
    last_pulled_at: string;
}

export async function saveCardsToCollection(
    userId: string,
    cards: PackCard[],
    setId: string
): Promise<{ error: string | null }> {
    // 1. Group cards within the pack to avoid redundant rows for duplicates
    const groupedCards = new Map<string, { card: PackCard, count: number }>();
    for (const card of cards) {
        const key = `${card.number}-${card.rarity}-${card.isReverseHolo}`;
        if (groupedCards.has(key)) {
            groupedCards.get(key)!.count += 1;
        } else {
            groupedCards.set(key, { card, count: 1 });
        }
    }

    // 2. Serialize cards for the atomic upsert RPC
    const payload = Array.from(groupedCards.values()).map(({ card, count }) => ({
        card_number: card.number,
        card_name: card.name,
        set_id: setId,
        rarity: card.rarity,
        is_reverse_holo: card.isReverseHolo,
        is_gallery: card.isGallery,
        image_small: card.imageSmall ?? null,
        image_large: card.imageLarge ?? null,
        market_price: card.marketPrice ?? null,
        quantity: count,
    }));

    // 3. Single atomic call — DB handles INSERT/UPDATE via ON CONFLICT
    const { error: upsertError } = await supabase.rpc('upsert_collection_cards', {
        p_user_id: userId,
        p_cards: payload,
    });

    if (upsertError) {
        console.error('[Sync] Upsert failed:', upsertError);
        return { error: upsertError.message };
    }

    // 4. Increment packs_opened counter
    try {
        await supabase.rpc('increment_packs_opened', { uid: userId });
    } catch {
        // Non-critical — log and continue
        console.warn('[Sync] Could not increment packs_opened');
    }

    return { error: null };
}

export async function loadCollection(
    userId: string,
    setId?: string
): Promise<{ cards: CollectionCard[]; error: string | null }> {
    // Supabase default limit is 1000 rows — paginate to get all cards
    const allCards: CollectionCard[] = [];
    const PAGE_SIZE = 1000;
    let from = 0;
    let keepGoing = true;

    while (keepGoing) {
        let query = supabase
            .from('collections')
            .select('*')
            .eq('user_id', userId)
            .order('last_pulled_at', { ascending: false })
            .order('id', { ascending: true })
            .range(from, from + PAGE_SIZE - 1);

        if (setId) {
            query = query.eq('set_id', setId);
        }

        const { data, error } = await query;

        if (error) return { cards: [], error: error.message };

        const rows = (data || []) as CollectionCard[];
        allCards.push(...rows);

        if (rows.length < PAGE_SIZE) {
            keepGoing = false;
        } else {
            from += PAGE_SIZE;
        }
    }

    return { cards: allCards, error: null };
}

export async function clearUserCollection(userId: string): Promise<{ error: string | null }> {
    const { error } = await supabase
        .from('collections')
        .delete()
        .eq('user_id', userId);

    if (error) return { error: error.message };
    return { error: null };
}

export async function getCollectionStats(userId: string): Promise<{
    totalCards: number;
    uniqueCards: number;
    totalValue: number;
    packsOpened: number;
}> {
    const defaultStats = { totalCards: 0, uniqueCards: 0, totalValue: 0, packsOpened: 0 };

    // Use server-side RPC to compute stats without downloading all rows
    const { data: stats, error: statsError } = await supabase
        .rpc('get_collection_stats', { uid: userId });

    const { data: profile } = await supabase
        .from('profiles')
        .select('packs_opened')
        .eq('id', userId)
        .maybeSingle();

    if (statsError || !stats) return { ...defaultStats, packsOpened: profile?.packs_opened || 0 };

    return {
        totalCards: Number(stats.total_cards) || 0,
        uniqueCards: Number(stats.unique_cards) || 0,
        totalValue: Number(stats.total_value) || 0,
        packsOpened: profile?.packs_opened || 0,
    };
}

/**
 * Convert Supabase collection cards back to PackCard format for rendering.
 */
export function collectionToPackCards(cards: CollectionCard[]): PackCard[] {
    const result: PackCard[] = [];
    for (const c of cards) {
        // Expand each row by its quantity so grouping in renderInventory counts correctly
        const qty = Math.max(1, c.quantity ?? 1);
        const base: PackCard = {
            number: c.card_number,
            name: c.card_name,
            type: '',
            emoji: '🃏',
            rarity: c.rarity,
            isReverseHolo: c.is_reverse_holo,
            isGallery: c.is_gallery,
            slotIndex: 0,
            imageSmall: c.image_small || undefined,
            imageLarge: c.image_large || undefined,
            marketPrice: c.market_price,
            setId: c.set_id,
        };
        for (let i = 0; i < qty; i++) {
            result.push({ ...base });
        }
    }
    return result;
}
