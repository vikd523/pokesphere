const fs = require('fs');

async function downloadSet(setId, outputFilename, setName, series, releaseDate) {
    console.log(`Fetching ${setName} from GitHub...`);
    try {
        const res = await fetch(`https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master/cards/en/${setId}.json`);

        if (!res.ok) {
            console.error(`Failed to fetch ${setId}: ${res.status} ${res.statusText}`);
            return;
        }

        const allCards = await res.json();
        const cardsMap = {};

        for (const card of allCards) {
            let rarity = (card.rarity || 'common').toLowerCase().replace(/ /g, '_');

            if (rarity.includes('secret') || rarity.includes('hyper')) rarity = 'secret_rare';
            else if (rarity.includes('ultra') || rarity.includes('vmax') || rarity.includes('vstar')) rarity = 'ultra_rare';
            else if (rarity.includes('illustration') || rarity.includes('gallery')) rarity = 'gallery';
            else if (rarity.includes('holo_rare') || rarity.includes('holofoil')) rarity = 'holo_rare';
            else if (rarity.includes('rare')) rarity = 'rare';
            else if (rarity.includes('uncommon')) rarity = 'uncommon';
            else rarity = 'common';

            if (card.id.includes('tg') || card.id.includes('gg') || card.supertype === 'Trainer') {
                if (card.id.includes('tg') || card.id.includes('gg')) rarity = 'gallery';
            }

            const isEnergy = card.supertype === 'Energy';
            if (isEnergy) rarity = 'energy';

            const cardData = {
                number: card.number,
                name: card.name,
                type: (card.types && card.types.length > 0) ? card.types[0] : (isEnergy ? 'energy' : 'Normal'),
                emoji: card.supertype === 'Trainer' ? '🎒' : '✨'
            };

            if (!cardsMap[rarity]) cardsMap[rarity] = [];
            cardsMap[rarity].push(cardData);
        }

        const setData = {
            set: {
                id: outputFilename.replace('.json', ''),
                name: setName,
                series: series,
                releaseDate: releaseDate,
                totalCards: allCards.length,
                apiSetId: setId
            },
            rarityWeights: {
                "rare": 0.85,
                "holo_rare": 0.08,
                "ultra_rare": 0.04,
                "radiant": 0.01,
                "full_art": 0.01,
                "secret_rare": 0.005,
                "gold": 0.005
            },
            reverseHoloGalleryChance: 0.10,
            cards: cardsMap
        };

        fs.writeFileSync(`./src/data/${outputFilename}`, JSON.stringify(setData, null, 2));
        console.log(`Saved ${setName} to ${outputFilename}`);
    } catch (e) {
        console.error('Exception on', setName, e);
    }
}

async function run() {
    await downloadSet('sv3pt5', 'pokemon-151.json', 'Scarlet & Violet—151', 'Scarlet & Violet', '2023-09-22');
    await downloadSet('swsh7', 'evolving-skies.json', 'Evolving Skies', 'Sword & Shield', '2021-08-27');
    await downloadSet('sv2', 'paldea-evolved.json', 'Paldea Evolved', 'Scarlet & Violet', '2023-06-09');
    await downloadSet('sv3', 'obsidian-flames.json', 'Obsidian Flames', 'Scarlet & Violet', '2023-08-11');
    await downloadSet('base1', 'base-set.json', 'Base Set', 'Base', '1999-01-09');
}

run();
