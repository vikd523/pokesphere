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
    for (const card of cards) {
        // Check if the card already exists
        const { data: existing } = await supabase
            .from('collections')
            .select('id, quantity')
            .eq('user_id', userId)
            .eq('card_number', card.number)
            .eq('set_id', setId)
            .eq('rarity', card.rarity)
            .eq('is_reverse_holo', card.isReverseHolo)
            .maybeSingle();

        if (existing) {
            // Increment quantity
            const { error } = await supabase
                .from('collections')
                .update({
                    quantity: existing.quantity + 1,
                    last_pulled_at: new Date().toISOString(),
                    market_price: card.marketPrice ?? null,
                    image_small: card.imageSmall ?? null,
                    image_large: card.imageLarge ?? null,
                })
                .eq('id', existing.id);

            if (error) {
                console.error('[Sync] Update failed:', error);
                return { error: error.message };
            }
        } else {
            // Insert new card
            const { error } = await supabase.from('collections').insert({
                user_id: userId,
                card_number: card.number,
                card_name: card.name,
                set_id: setId,
                rarity: card.rarity,
                is_reverse_holo: card.isReverseHolo,
                is_gallery: card.isGallery,
                image_small: card.imageSmall ?? null,
                image_large: card.imageLarge ?? null,
                market_price: card.marketPrice ?? null,
                quantity: 1,
            });

            if (error) {
                console.error('[Sync] Insert failed:', error);
                return { error: error.message };
            }
        }
    }

    // Increment packs_opened counter
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

    const { data: cards } = await supabase
        .from('collections')
        .select('quantity, market_price')
        .eq('user_id', userId);

    const { data: profile } = await supabase
        .from('profiles')
        .select('packs_opened')
        .eq('id', userId)
        .maybeSingle();

    if (!cards) return defaultStats;

    return {
        totalCards: cards.reduce((sum, c) => sum + (c.quantity || 1), 0),
        uniqueCards: cards.length,
        totalValue: cards.reduce((sum, c) => sum + ((c.market_price || 0) * (c.quantity || 1)), 0),
        packsOpened: profile?.packs_opened || 0,
    };
}

/**
 * Convert Supabase collection cards back to PackCard format for rendering.
 */
export function collectionToPackCards(cards: CollectionCard[]): PackCard[] {
    return cards.map(c => ({
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
    }));
}
