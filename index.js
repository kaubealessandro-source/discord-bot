console.log("1 - FILE STARTED");
require("dotenv").config();


process.on("uncaughtException", (err) => {
    console.error("CRASH:", err);
});

process.on("unhandledRejection", (err) => {
    console.error("PROMISE ERROR:", err);
});

const { Client, GatewayIntentBits } = require("discord.js");
const fs = require("fs");

/* ================= FILE SYSTEM ================= */

const DATA_FILE = "./data.json";

const pendingSell = {};
const pendingMarketSell = {};
const pendingAuctionSell = {};
const pendingLineup = {};
const pendingFavourite = {};
let auctions = [];

/* ================= GAME STATE ================= */

let users = {};
let marketListings = [];
let globalExists = {};
let guilds = {};
const COLLECTION_SETS = [
    {
        id: "japan_trio",
        name: "The Japan Trio",
        description: "Complete Benji, Djay, and Knap (Hero cards) to unlock a special reward.",
        requiredCards: ["c83", "c84", "c85"],
        rewardCard: "c93",
        rewardClaimedBy: []
    }
];
const playCooldown = new Set();
const axios = require("axios");
const RARE_WEBHOOK_URL = "https://discord.com/api/webhooks/1517615872674631851/B2pRB7BPFVoaHlz8CPZZEPg-cxj0gND0rcJM6arVKZf7IHafCI46-FhtSOpix46sv6CT";
const pendingView = {};





/* ================= CLIENT ================= */

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});



function getGuild(guildId) {
    const g = guilds[guildId];
    if (!g) return null;

    // safety defaults
    g.members ??= [];
    g.balance ??= 0;
    g.level ??= 1;
    g.upgrades ??= 0;

    g.perks ??= {
        packLuck: 0,
        moneyBoost: 0
    };

    return g;
}


if (fs.existsSync(DATA_FILE)) {
    try {
        const raw = fs.readFileSync(DATA_FILE, "utf8");
        const data = JSON.parse(raw);

        // =====================
        // BASE STATE LOADING
        // =====================
        users = data.users || {};
        marketListings = data.marketListings || [];
        auctions = data.auctions || [];
        globalExists = data.globalExists || {};
       COLLECTION_SETS.length = 0;
if (Array.isArray(data.COLLECTION_SETS)) {
    COLLECTION_SETS.push(...data.COLLECTION_SETS);
}

guilds = data.guilds || {};

// 🔥 NORMALIZE / FIX OLD + BROKEN DATA
for (const id in guilds) {
    const g = guilds[id];

    g.bank = Number(g.bank) || 0;

    g.upgrades = {
        packLuck: Number(g?.upgrades?.packLuck) || 0,
        moneyBoost: Number(g?.upgrades?.moneyBoost) || 0
    };
}

        // =====================
        // USER MIGRATION
        // =====================
        for (const id in users) {
            const u = users[id];

            if (!u || typeof u !== "object") {
                users[id] = createDefaultUser?.() || {
                    money: 1000,
                    club: [],
                    lineup: { GK: null, CM1: null, CM2: null, LW: null, RW: null },
                    packsOpened: 0,
                    completedSets: [],
                    specialCards: {},
                    guild: null,
                    guildRole: null,
                    guildBonus: 0
                };
                continue;
            }

            // old club format migration
            if (!Array.isArray(u.club)) {
                const old = u.club || {};
                const newClub = [];

                for (const cardId in old) {
                    const amount = old[cardId];

                    for (let i = 0; i < amount; i++) {
                        newClub.push({
                            instanceId: `${cardId}_${Date.now()}_${Math.floor(Math.random() * 1e9)}`,
                            cardId,
                            variant: "GOLD"
                        });
                    }
                }

                u.club = newClub;
            }

            // defaults
            u.money ??= 1000;
            u.club ??= [];
            u.favourites ??= [];
            u.lineup ??= {
                GK: null,
                CM1: null,
                CM2: null,
                LW: null,
                RW: null
            };
            u.packsOpened ??= 0;
            u.completedSets ??= [];
            u.specialCards ??= {};
            u.guild ??= null;
            u.guildRole ??= null;
            u.guildBonus ??= 0;
        }

        // =====================
        // GUILD NORMALIZATION (IMPORTANT FIX)
        // =====================
        for (const id in guilds) {
            const g = guilds[id];

            if (!g || typeof g !== "object") {
                guilds[id] = createDefaultGuild?.() || {
                    members: [],
                    upgrades: { packLuck: 0, auctionFeeReduction: 0 },
                    competitions: { wins: 0, losses: 0, points: 0 },
                    bank: 0,
                    owner: null
                };
                continue;
            }

            g.members ??= [];
            g.upgrades ??= { packLuck: 0, auctionFeeReduction: 0 };
            g.competitions ??= { wins: 0, losses: 0, points: 0 };
            g.bank ??= 0;
            g.owner ??= null;
        }

        console.log("✅ Data loaded + fully normalized (users + guilds safe)");

    } catch (err) {
        console.log("❌ Failed to load data.json, starting fresh");
        console.error(err);

        users = {};
        marketListings = [];
        auctions = [];
        globalExists = {};
        guilds = {};
        COLLECTION_SETS = [];
    }
}

if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({
        users: {},
        marketListings: [],
        auctions: [],
        globalExists: {},
        guilds: {},
        COLLECTION_SETS: []
    }, null, 2));
}

// =====================
// SAVE FUNCTION
// =====================
function saveData() {
    const data = {
        users,
        marketListings,
        auctions,
        globalExists,
        guilds,
        COLLECTION_SETS
    };

    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// =====================
// COLLECTION CHECKER
// =====================

function checkCollections(user) {
    if (!user.completedSets) user.completedSets = [];

    for (const set of COLLECTION_SETS) {
        if (user.completedSets.includes(set.id)) continue;

        const hasAll = set.requiredCards.every(cardId =>
            user.club.some(c => c.cardId === cardId)
        );

        if (hasAll) {
            user.completedSets.push(set.id);

            user.club.push({
                instanceId: `${set.rewardCard}_${Date.now()}_${Math.floor(Math.random() * 1e9)}`,
                cardId: set.rewardCard,
                variant: "SPECIAL"
            });

            return set;
        }
    }

    return null;
}

// =====================
// USER NORMALIZATION
// =====================
for (const id in users) {
    const u = users[id];

    if (!u || typeof u !== "object") continue;

    u.money ??= 1000;
    u.lineup ??= { GK: null, CM1: null, CM2: null, LW: null, RW: null };
    u.packsOpened ??= 0;
    u.completedSets ??= [];
    u.specialCards ??= {};
    u.guild ??= null;
    u.guildRole ??= null;
    u.guildBonus ??= 0;
    u.club ??= [];

    // 🔥 FIX: ensure guild consistency
    if (u.guild && guilds[u.guild]) {
        const g = guilds[u.guild];

        g.members ??= [];

        if (!g.members.includes(id)) {
            g.members.push(id);
        }
    } else {
        // user thinks they are in a non-existent guild
        u.guild = null;
        u.guildRole = null;
        u.guildBonus = 0;
    }
}

// =====================
// GUILD NORMALIZATION
// =====================
for (const id in guilds) {
    const g = guilds[id];

    if (!g || typeof g !== "object") {
        guilds[id] = createDefaultGuild?.() || {
            members: [],
            upgrades: { packLuck: 0, auctionFeeReduction: 0 },
            competitions: { wins: 0, losses: 0, points: 0 },
            bank: 0,
            owner: null
        };
        continue;
    }

    g.members ??= [];
    g.upgrades ??= { packLuck: 0, auctionFeeReduction: 0 };
    g.competitions ??= { wins: 0, losses: 0, points: 0 };
    g.bank ??= 0;
    g.owner ??= null;

    // 🔥 cleanup invalid members
    g.members = g.members.filter(uid => users[uid]);
}


/* ================= USER SYSTEM ================= */


/* ================= DEFAULT USER ================= */

function createDefaultUser() {
    return {
        money: 1000,
        club: [],

        packsOpened: 0,
        bestCard: 0,

        lineup: {
            GK: null,
            CM1: null,
            CM2: null,
            LW: null,
            RW: null
        },

        completedSets: [],
        specialCards: {},
           favourites: [],

        // 🔥 FIX: guild is ALWAYS an object, never null
     guild: {
    name: null,
    balance: 0,
    level: 1,
    upgrades: 0,

    members: [],

    perks: {
        packLuck: 0, // %
        moneyBoost: 0 // optional keep
    }
},

        guildRole: null,
        guildBonus: 0
    };
}

/* ================= SAFE GETTER (SELF-HEALING) ================= */

function getUser(id) {
    if (!users[id]) {
        users[id] = createDefaultUser();
    }

    const u = users[id];
    const def = createDefaultUser();

    u.money ??= def.money;
    u.club ??= def.club;
    u.packsOpened ??= def.packsOpened;
    u.bestCard ??= def.bestCard;
    u.lineup ??= def.lineup;
    u.completedSets ??= def.completedSets;
    u.specialCards ??= def.specialCards;

    // ✅ guild safety INSIDE function ONLY
    u.guild ??= structuredClone(def.guild);

    u.guild.name ??= def.guild.name;
    u.guild.balance ??= def.guild.balance;
    u.guild.members ??= [];
    u.guild.perks ??= def.guild.perks;

    u.guildRole ??= def.guildRole;
    u.guildBonus ??= def.guildBonus;

    return u;
}

// ================= GUILD FIX (IMPORTANT) =================



/* ================= ONE-TIME MIGRATION ================= */

function migrateUsers() {
    for (const id in users) {
        const u = users[id];

        if (!u || typeof u !== "object") {
            users[id] = createDefaultUser();
            continue;
        }

        const def = createDefaultUser();

        // 🔥 ensure full schema consistency
        u.money ??= def.money;
        u.packsOpened ??= def.packsOpened;
        u.bestCard ??= def.bestCard;
        u.lineup ??= def.lineup;
        u.completedSets ??= def.completedSets;
        u.specialCards ??= def.specialCards;
        u.guild ??= def.guild;
        u.guildRole ??= def.guildRole;
        u.guildBonus ??= def.guildBonus;

        u.club ??= [];

        // 🔥 migrate old object-based club → array-based club
        if (!Array.isArray(u.club)) {
            const old = u.club || {};
            const newClub = [];

            for (const cardId in old) {
                const amount = old[cardId];

                for (let i = 0; i < amount; i++) {
                    newClub.push({
                        instanceId: `${cardId}_${Math.random().toString(36).slice(2)}`,
                        cardId,
                        variant: "GOLD"
                    });
                }
            }

            u.club = newClub;
        }
    }

    console.log("✅ User migration complete");
}

/* ================= CARDS ================= */

const CARDS = [
    { id: "c1", name: "Ron", rating: 72, rarity: "SILVER", position: "GK", nation: "🇦🇱", baseValue: 150, dropChance: 7.864877, image: "https://media.discordapp.net/attachments/1431997944424562738/1517153186128072754/Ron_1_1.png?ex=6a353e82&is=6a33ed02&hm=791f15e4873915b4689135e4f9ee9aaf7c08db8f58a49e16817c96e8ad24657e&=&format=webp&quality=lossless&width=612&height=856" },
    { id: "c2", name: "Sub", rating: 74, rarity: "SILVER", position: "CM", nation: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", baseValue: 150, dropChance:6,  image: "https://media.discordapp.net/attachments/1431997944424562738/1517153185423425698/sub_1.png?ex=6a353e82&is=6a33ed02&hm=14f4730589a493a493ce1d401ae0395548b116ba4607994e4444bad552dca667&=&format=webp&quality=lossless&width=612&height=856" },
    { id: "c3", name: "Hayden", rating: 77, rarity: "GOLD", position: "CM", nation: "🏴󠁧󠁢󠁳󠁣󠁴󠁿", baseValue: 250, dropChance: 5, image: "https://media.discordapp.net/attachments/1431997944424562738/1517153185041485854/hayden_2.png?ex=6a353e82&is=6a33ed02&hm=80c892641e03bf3c5396f642a962cd34322b87bd31908942dc0387a717c2bbe8&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c4", name: "Kit", rating: 78, rarity: "GOLD", position: "LW", nation: "🇨🇾", baseValue: 320, dropChance:4,  image: "https://media.discordapp.net/attachments/1431997944424562738/1517259555191390208/kit_11.png?ex=6a35a193&is=6a345013&hm=8cb7c1ad17b2f1eac6d74c4b6453bf677bb105a33f68ee213fcfe7648b3b5676&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c5", name: "Musta", rating: 78, rarity: "GOLD", position: "GK", nation: "🇵🇰", baseValue: 320, dropChance:4,  image: "https://media.discordapp.net/attachments/1431997944424562738/1517259554684141689/musta_3.png?ex=6a35a193&is=6a345013&hm=57e30e66ccf92fd15489f81c625c97ceae4322ced72e8f7119160b8c9b9ae073&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c6", name: "Spigniv", rating: 78, rarity: "GOLD", position: "CM", nation: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", baseValue: 320, dropChance:4,  image: "https://media.discordapp.net/attachments/1431997944424562738/1517259554205859860/spigniv_1.png?ex=6a35a193&is=6a345013&hm=e06bd9bc55aad7e7d637d06e8297cf540f3d67ae631dff3d81879b9ef853a01e&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c7", name: "Petr", rating: 78, rarity: "GOLD", position: "CM", nation: "🇦🇹", baseValue: 320, dropChance:4,  image: "https://media.discordapp.net/attachments/1431997944424562738/1517259553761267953/petr_8.png?ex=6a35a192&is=6a345012&hm=e41339a6859ed0ac1d58270e65a2d3cf2e0c1833de76196e71b4e3f30b34cac2&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c8", name: "Milo", rating: 79, rarity: "GOLD", position: "LW", nation: "🇸🇪", baseValue: 440, dropChance:3,  image: "https://media.discordapp.net/attachments/1431997944424562738/1517259553383645234/milo_1.png?ex=6a35a192&is=6a345012&hm=993df24cffdca6934f73835d8b846ffceb30bcf94a9413823b0cbba2ce1911d1&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c9", name: "Jasser", rating: 79, rarity: "GOLD", position: "GK", nation: "🇹🇳", baseValue: 440, dropChance:3,  image: "https://media.discordapp.net/attachments/1459098362119717064/1517280137517859027/jasser_4.png?ex=6a35b4be&is=6a34633e&hm=8ca87e3f0327db259a4d5c76ea9d098bc2ff7d96105656a1421227a033b5f152&=&format=webp&quality=lossless&width=687&height=960" },
{ id: "c10", name: "Ehzy", rating: 80, rarity: "GOLD", position: "GK", nation: "🇭🇷", baseValue: 650, dropChance:1.5,  image: "https://media.discordapp.net/attachments/1431997944424562738/1517266937841717278/ehzy_1.png?ex=6a35a873&is=6a3456f3&hm=00e9e1d3e0f319e57977a68a2015c341a6f8159c62f30c4f19d7163325d53dc1&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c11", name: "Peely", rating: 80, rarity: "GOLD", position: "CM", nation: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", baseValue: 650, dropChance:1.5,  image: "https://media.discordapp.net/attachments/1431997944424562738/1517266937392922644/peely_11.png?ex=6a35a873&is=6a3456f3&hm=c9e2cc61d19bbea11c2be8b9dc3e56a1810c30835572346e5c1bbb835dcaf902&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c12", name: "Hala", rating: 80, rarity: "GOLD", position: "CM", nation: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", baseValue: 650, dropChance:1.5,  image: "https://media.discordapp.net/attachments/1431997944424562738/1517266936898130000/hala_5.png?ex=6a35a873&is=6a3456f3&hm=beb3d0bc5a783581aec04d4effa044d21777b91cf764a6417e5671c7294d03f4&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c13", name: "Tays", rating: 80, rarity: "GOLD", position: "RW", nation: "🇰🇪", baseValue: 650, dropChance:1.5,  image: "https://media.discordapp.net/attachments/1431997944424562738/1517266936189161512/tays_9.png?ex=6a35a873&is=6a3456f3&hm=bcc8858acb219a1496b951101894fadd8857da0bce85bab579851bdde84e8bce&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c14", name: "Monke", rating: 81, rarity: "GOLD", position: "RW", nation: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", baseValue: 900, dropChance:1,  image: "https://media.discordapp.net/attachments/1431997944424562738/1517278395606499440/monke_3.png?ex=6a35b31f&is=6a34619f&hm=1bc56351fbb174629f2e6ef66b4f819a9e9d9231540335d7b6e7fefdbffda4e1&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c15", name: "Realz", rating: 81, rarity: "GOLD", position: "CM", nation: "🇦🇱", baseValue: 900, dropChance:1,  image: "https://cdn.discordapp.com/attachments/1431997944424562738/1517278395132809389/realz_3.png?ex=6a35b31f&is=6a34619f&hm=53f67aa0697d5cba138cd2aafdfa7f218da8f7e6da9e5448ebfdf4207fbdc2ee&" },
{ id: "c16", name: "Azelf", rating: 81, rarity: "GOLD", position: "CM", nation: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", baseValue: 900, dropChance:1,  image: "https://media.discordapp.net/attachments/1431997944424562738/1517278386907512962/azelf_5.png?ex=6a35b31d&is=6a34619d&hm=565c16a3c4c561cf10ed8887cb2c4d03230ec4558717f6e6b1c7ec359e9c3578&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c17", name: "Alex", rating: 72, rarity: "SILVER", position: "GK", nation: "🇪🇸", baseValue: 140, dropChance:8,  image: "https://media.discordapp.net/attachments/1431997944424562738/1517278396135112895/al3x_2.png?ex=6a35b31f&is=6a34619f&hm=6be38d94f73777d2e24403907922539c5b8b9f5ac191c96f7019d56f08db83ea&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c18", name: "Soggy", rating: 82, rarity: "GOLD", position: "RW", nation: "🏴󠁧󠁢󠁳󠁣󠁴󠁿", baseValue: 1500, dropChance:0.8,  image: "https://cdn.discordapp.com/attachments/1431997944424562738/1517305656686940230/soggy_6.png?ex=6a35cc82&is=6a347b02&hm=e6008e8e00d858d604c8e1fff3b432b67441ade00b54f17cb236302ffd966aef&" },
{ id: "c19", name: "Cahl", rating: 82, rarity: "GOLD", position: "GK", nation: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", baseValue: 1500, dropChance:0.8,  image: "https://media.discordapp.net/attachments/1431997944424562738/1517305652442300446/cahl_7.png?ex=6a35cc81&is=6a347b01&hm=a535182324838d11d955a94b32a498d3a483e965d9080558cd992e63f409b2f3&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c20", name: "Adz", rating: 83, rarity: "GOLD", position: "GK", nation: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", baseValue: 2400, dropChance:0.5,  image: "https://media.discordapp.net/attachments/1431997944424562738/1517305652068880384/adz_1.png?ex=6a35cc81&is=6a347b01&hm=b6fd57a4d7d883892c18d43230dcda09392fd8937c7f6f855af43a805db929dd&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c21", name: "K4lxx", rating: 84, rarity: "GOLD", position: "GK", nation: "🇮🇶", baseValue: 4400, dropChance:0.1,  image: "https://media.discordapp.net/attachments/1431997944424562738/1517305651724816514/k4lxx_1.png?ex=6a35cc81&is=6a347b01&hm=a76caa0ee2239f655b9c77cc15ee01ce266b91fb01b5aa9f05f5ec21caa63f7d&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c22", name: "Mal", rating: 84, rarity: "GOLD", position: "CM", nation: "🇾🇪", baseValue: 4400, dropChance:0.1,  image: "https://media.discordapp.net/attachments/1431997944424562738/1517305650470977687/mal_3.png?ex=6a35cc81&is=6a347b01&hm=eadc712194361ab6bee03a34a4572c97a156f910e8358d06d72b01431422589d&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c23", name: "Seed", rating: 85, rarity: "GOLD", position: "LW", nation: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", baseValue: 8000, dropChance:0.04,  image: "https://media.discordapp.net/attachments/1431997944424562738/1517305650114330696/seed_1.png?ex=6a35cc81&is=6a347b01&hm=37d11fb7b2b3c2fcd52ac5536af843a04cfe02dfc825941663e32639e812afcc&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c24", name: "Tacinek", rating: 86, rarity: "GOLD", position: "GK", nation: "🇵🇱", baseValue: 14000, dropChance:0.02,  image: "https://media.discordapp.net/attachments/1431997944424562738/1517305651376947410/tacinek_11.png?ex=6a35cc81&is=6a347b01&hm=e6548d3d0bc68c3ab777825c10861c44976cefd8510e51268ad26ec038c63803&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c25", name: "AntonioJuan", rating: 86, rarity: "GOLD", position: "CM", nation: "🇸🇪", baseValue: 14000, dropChance:0.02,  image: "https://media.discordapp.net/attachments/1431997944424562738/1517305649674059907/antonio_1.png?ex=6a35cc81&is=6a347b01&hm=47168487b408f7ce6efe3216c8a77e998507c35b71e60bb5c8ba0cf257f6ab9b&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c26", name: "Mrsleepy", rating: 88, rarity: "GOLD", position: "GK", nation: "🇧🇪", baseValue: 50000, dropChance:0.003,  image: "https://media.discordapp.net/attachments/1431997944424562738/1517305650906927316/mrsleepy_3.png?ex=6a35cc81&is=6a347b01&hm=272dd5cb667de501319269aff0063902ea4adb244827c538d9b1a63fdea0a4cd&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c27", name: "Snickz", rating: 88, rarity: "GOLD", position: "RW", nation: "🇦🇫", baseValue: 50000, dropChance:0.003,  image: "https://media.discordapp.net/attachments/1431997944424562738/1517305649233531121/snickz_7.png?ex=6a35cc80&is=6a347b00&hm=5ea881e2ec72f9741370dc170cf33fbbe04dd34ea6771f23e5d46271fe807b2a&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c28", name: "Kronx", rating: 90, rarity: "GOLD", position: "RW", nation: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", baseValue: 100000, dropChance:0.0001,  image: "https://media.discordapp.net/attachments/1431997944424562738/1517305648625352704/kronx_1.png?ex=6a35cc80&is=6a347b00&hm=107a903e3db8fdc7c668f88216e87b66b15b56a2b51f9d510b0ecea5c2edc894&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c29", name: "Snickz", rating: 92, rarity: "POTM", position: "RW", nation: "🇦🇫", baseValue: 175000, dropChance:0.00003,  image: "https://media.discordapp.net/attachments/1431997944424562738/1516754697934082149/Snickz_5_1.png?ex=6a35c5a3&is=6a347423&hm=7d8bc9842c6ff5868a4fb2671d75aa76b6dbefbc0395e16b042565df55766c43&=&format=webp&quality=lossless&width=687&height=960" },
{ id: "c30", name: "Eng", rating: 87, rarity: "TOTW", position: "RW", nation: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", baseValue: 28000, dropChance:0.005,  image: "https://media.discordapp.net/attachments/1459098362119717064/1517313623742218452/eng_7.png?ex=6a35d3ee&is=6a34826e&hm=e288d96e242964f355cf920158a534e8a019db36c651277ff3e2e542910660f5&=&format=webp&quality=lossless&width=687&height=960" },
{ id: "c31", name: "Tays", rating: 86, rarity: "TOTW", position: "LW", nation: "🇰🇪", baseValue: 14000, dropChance:0.02,  image: "https://media.discordapp.net/attachments/1431997944424562738/1516754603209920563/tays_7.png?ex=6a35c58d&is=6a34740d&hm=e4ea385a2213e2d3488f9ecea380929f5b9b9f358adebd6e03c50cc258bb245d&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c32", name: "Mal", rating: 87, rarity: "TOTW", position: "CM", nation: "🇾🇪", baseValue: 28000, dropChance:0.005,  image: "https://media.discordapp.net/attachments/1431997944424562738/1516754602777903144/mal_1.png?ex=6a35c58d&is=6a34740d&hm=4355c870e3971128ec35cc80e0ba42f6ca82d7e785a6713d0c401e1430455e4c&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c33", name: "Ehzy", rating: 89, rarity: "TOTW", position: "GK", nation: "🇭🇷", baseValue: 85000, dropChance:0.0006,  image: "https://media.discordapp.net/attachments/1431997944424562738/1516754602433712268/Crafty_1_1.png?ex=6a35c58d&is=6a34740d&hm=049dd21a67dd46465ac62e51ac55887a53f60fdc89b4ecad60bcffab4b6ba7e1&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c34", name: "Petr", rating: 86, rarity: "TOTW", position: "LW", nation: "🇦🇹", baseValue: 14000, dropChance:0.02,  image: "https://media.discordapp.net/attachments/1431997944424562738/1516754493620883476/petr_6.png?ex=6a35c573&is=6a3473f3&hm=75754a872e6753ba3aa6a63bba09c707ccbcef82fd8c64e2612a99d6a5489e76&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c35", name: "Musa", rating: 85, rarity: "TOTW", position: "RW", nation: "🇵🇰", baseValue: 8000, dropChance:0.04,  image: "https://media.discordapp.net/attachments/1431997944424562738/1516754493989978152/musa_14.png?ex=6a35c573&is=6a3473f3&hm=f2856e7c95f88e7cfc813d560c1cf730553ec64c2f2322c0055624f9ab445d7f&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c36", name: "Azelf", rating: 85, rarity: "TOTW", position: "CM", nation: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", baseValue: 8000, dropChance:0.04,  image: "https://media.discordapp.net/attachments/1431997944424562738/1516754493239332994/azelf_3.png?ex=6a35c573&is=6a3473f3&hm=970afd7eea875f900067b620c9e691a43b080d22ee867d611084ff9c32398b39&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c37", name: "Jasser", rating: 84, rarity: "TOTW", position: "GK", nation: "🇹🇳", baseValue: 4400, dropChance:0.1,  image: "https://media.discordapp.net/attachments/1431997944424562738/1516754492664844338/Jasser_2_1.png?ex=6a35c572&is=6a3473f2&hm=1cdd681b6c9eebef86c0a6500e63cb67b995ccd9d632cfde19464cd23d8dcc2f&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c38", name: "Tays", rating: 88, rarity: "TOTW", position: "RW", nation: "🇰🇪", baseValue: 50000, dropChance:0.003,  image: "https://media.discordapp.net/attachments/1431997944424562738/1516754364453359708/tays_5.png?ex=6a35c554&is=6a3473d4&hm=a00f8fde92685b97b110f5c7237c022c9abf1898ce514454d9b5b4248d2a7e78&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c39", name: "Snickz", rating: 88, rarity: "TOTW", position: "LW", nation: "🇦🇫", baseValue: 50000, dropChance:0.003,  image: "https://media.discordapp.net/attachments/1431997944424562738/1516754364042051594/snickz_2.png?ex=6a35c554&is=6a3473d4&hm=0d630523b492bd6abc456f0e19796227f764dca4d39f152dc99a79ff00521a8d&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c40", name: "Kit", rating: 87, rarity: "TOTW", position: "CM", nation: "🇨🇾", baseValue: 28000, dropChance:0.005,  image: "https://media.discordapp.net/attachments/1431997944424562738/1516754363450921031/kit_9.png?ex=6a35c554&is=6a3473d4&hm=6eabe66da701fb44fdff49a0c6f4a9d4e9cecdd188b3bf017d5158997c2c6bd8&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c41", name: "Musta", rating: 88, rarity: "TOTW", position: "GK", nation: "🇵🇰", baseValue: 50000, dropChance:0.003,  image: "https://media.discordapp.net/attachments/1431997944424562738/1516754363077496872/Musta_1_1.png?ex=6a35c554&is=6a3473d4&hm=d8f2d3eccbaaa4697feeaeed047b8821ee53356e31b664b97596294057ceb38f&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c42", name: "Marchiki", rating: 90, rarity: "Future_Stars", position: "RW", nation: "🇱🇻", baseValue: 100000, dropChance:0.0001,  image: "https://media.discordapp.net/attachments/1431997944424562738/1516754140947021854/marchiki_7.png?ex=6a35c51f&is=6a34739f&hm=3cfd88cc58bf315a14a4eb21617401c1d9e0fba38f858a8d229134e56df019e1&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c43", name: "W90a", rating: 93, rarity: "Future_Stars", position: "LW", nation: "🇵🇱", baseValue: 250000, dropChance:0.000008,  image: "https://media.discordapp.net/attachments/1431997944424562738/1516754140410155128/w90a_4.png?ex=6a35c51f&is=6a34739f&hm=baaa20339a584eec0bd5533c79e29324b38273a83add0cb983be25bf042d84fc&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c44", name: "Hala", rating: 90, rarity: "Future_Stars", position: "CM", nation: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", baseValue: 100000, dropChance:0.0001,  image: "https://media.discordapp.net/attachments/1431997944424562738/1516754139949039626/hala_3.png?ex=6a35c51e&is=6a34739e&hm=ee207bd312197ce19a187194d9c897e02454c3c33f359dab95ae8e60e1a43201&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c45", name: "Manly", rating: 92, rarity: "Future_Stars", position: "GK", nation: "🇦🇲", baseValue: 175000, dropChance:0.00003,  image: "https://media.discordapp.net/attachments/1431997944424562738/1516754139315572796/Manly_1.png?ex=6a35c51e&is=6a34739e&hm=8a35b10823e6d295cee0fb209b38601ea06ed8afd9ce36203db2b63d79aacc55&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c46", name: "Zain", rating: 84, rarity: "Future_Stars", position: "RW", nation: "🇵🇰", baseValue: 4400, dropChance:0.1,  image: "https://media.discordapp.net/attachments/1431997944424562738/1516754138883555399/zain_2.png?ex=6a35c51e&is=6a34739e&hm=80b8d5e870d7275b43e635ce1de030af73258b629775033ca071b71a9d26a900&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c47", name: "Ryan", rating: 85, rarity: "Future_Stars", position: "LW", nation: "🇪🇸", baseValue: 8000, dropChance:0.04,  image: "https://media.discordapp.net/attachments/1431997944424562738/1516754138354942063/ryan_5.png?ex=6a35c51e&is=6a34739e&hm=f15f71bb4f954df1a4a68d218afdb86106e25b8926fa9e906f9aafdd7f6bc07f&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c48", name: "Janko", rating: 84, rarity: "Future_Stars", position: "GK", nation: "🇸🇰", baseValue: 4400, dropChance:0.1,  image: "https://media.discordapp.net/attachments/1431997944424562738/1516754137713344592/Janko_1.png?ex=6a35c51e&is=6a34739e&hm=8783d6d01b3418e0e99cf872bc6be690a164eb81fc0ca2d8095e0f8e0cf90602&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c49", name: "Kirsch", rating: 84, rarity: "Future_Stars", position: "CM", nation: "🇻🇳", baseValue: 4400, dropChance:0.1,  image: "https://media.discordapp.net/attachments/1431997944424562738/1516754137164021801/kirsch_1.png?ex=6a35c51e&is=6a34739e&hm=53fa4df09352346cf829fc4446c01dbd57098cd8d82d68ecd3f2504f21536b00&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c50", name: "Petr", rating: 85, rarity: "TOTW", position: "CM", nation: "🇦🇹", baseValue: 8000, dropChance:0.04,  image: "https://media.discordapp.net/attachments/1431997944424562738/1451697737119830187/Blox_2_2.png?ex=6a35bddf&is=6a346c5f&hm=4651a2c006fe0bc3caa4d99af178f3e34fb5d38a96524905b04203b7bbb5b28d&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c51", name: "Blox", rating: 88, rarity: "TOTW", position: "GK", nation: "🇫🇷", baseValue: 50000, dropChance:0.003,  image: "https://media.discordapp.net/attachments/1431997944424562738/1451697736662646814/Blox_2_1.png?ex=6a35bddf&is=6a346c5f&hm=2e5919c485c1f6cfedc20af2a82f0ab882e2df58a7115bdfa9b11f3fdc296617&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c52", name: "Tyler", rating: 87, rarity: "TOTW", position: "LW", nation: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", baseValue: 28000, dropChance:0.005,  image: "https://media.discordapp.net/attachments/1431997944424562738/1451697730547355852/Blox_2_3.png?ex=6a36669e&is=6a35151e&hm=7f3fc9d7bb515515ca71b09d82cbd2b9f981fb5d84755cc47b0d115995b05cb8&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c53", name: "Oliver", rating: 88, rarity: "TOTW", position: "RW", nation: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", baseValue: 50000, dropChance:0.003,  image: "https://media.discordapp.net/attachments/1431997944424562738/1451697730131988480/Blox_2_4.png?ex=6a36669e&is=6a35151e&hm=15ea71523641fda9cd7cade2dccf510fce946e346db05beda33017f09b1329fc&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c54", name: "Tays", rating: 88, rarity: "TOTW", position: "GK", nation: "🇰🇪", baseValue: 50000, dropChance:0.003,  image: "https://media.discordapp.net/attachments/1431997944424562738/1451697729725268008/Tays_2_1.png?ex=6a36669e&is=6a35151e&hm=bb44902dcf8cd1b8b7860c2e57afa11a354e5ac98cf88c2d971878de6b7e5cf8&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c55", name: "Djaymang", rating: 87, rarity: "TOTW", position: "CM", nation: "🇳🇱", baseValue: 28000, dropChance:0.005,  image: "https://media.discordapp.net/attachments/1431997944424562738/1451697729289064530/Tays_2_2.png?ex=6a36669d&is=6a35151d&hm=1219c1280ccac06303c3f8698103a85b5db49745870cacf9324351726c154918&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c56", name: "Knap", rating: 89, rarity: "TOTW", position: "LW", nation: "🇸🇰", baseValue: 85000, dropChance:0.0006,  image: "https://media.discordapp.net/attachments/1431997944424562738/1451697728621908099/Tays_2_3.png?ex=6a36669d&is=6a35151d&hm=5409bfe9882f412077eb6b1781a0a6bb895366d8e86846e2fc662d015c8bb4e5&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c57", name: "Tacinek", rating: 90, rarity: "TOTW", position: "RW", nation: "🇵🇱", baseValue: 100000, dropChance:0.0001,  image: "https://media.discordapp.net/attachments/1431997944424562738/1451697728227901594/Tays_2_4.png?ex=6a36669d&is=6a35151d&hm=697eeab620ea63e52b7b279091781766261a086bfa5576ab840d793362b4fec1&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c58", name: "Bomisicu", rating: 81, rarity: "GOLD", position: "LW", nation: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", baseValue: 900, dropChance:1.2,  image: "https://media.discordapp.net/attachments/1431997944424562738/1452388298927378664/Petr_1_3.png?ex=6a3646c2&is=6a34f542&hm=e35128dab25256ac9aef6bd2c91c638f97488e1dd1678f40b8ac6decac2394c8&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c59", name: "Oliver", rating: 82, rarity: "GOLD", position: "RW", nation: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", baseValue: 1500, dropChance:0.8,  image: "https://media.discordapp.net/attachments/1431997944424562738/1452388299367776296/Petr_1_2.png?ex=6a3646c2&is=6a34f542&hm=7ee6380d5cd3284eb3c6021375446fc889541c54404ff317eb99810c9096ca4b&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c60", name: "Ali", rating: 72, rarity: "SILVER", position: "GK", nation: "🇪🇬", baseValue: 150, dropChance:8,  image: "https://media.discordapp.net/attachments/1431997944424562738/1452596025314512968/Pekka_3.png?ex=6a365f78&is=6a350df8&hm=043a38da6ef0141e3e45de3fa702b86d287e26aa54854cd8e82bb362a28249fa&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c61", name: "Unknown", rating: 78, rarity: "GOLD", position: "RW", nation: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", baseValue: 320, dropChance:4,  image: "https://media.discordapp.net/attachments/1431997944424562738/1452596026350370850/Pekka_2.png?ex=6a365f78&is=6a350df8&hm=3abde49776a3f513a9ec8b9aa6cfe5fe7b1a0dcce95d9fd48bdeb2b8578443d6&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c62", name: "Pekka", rating: 80, rarity: "GOLD", position: "CM", nation: "🇧🇪", baseValue: 650, dropChance:1.5,  image: "https://media.discordapp.net/attachments/1431997944424562738/1452596027218722968/Pekka_1.png?ex=6a365f78&is=6a350df8&hm=1bbca685a0adc3e1a0d996476514a5785d88fc9f004075c008efc3e5138cfd83&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c63", name: "Blox", rating: 79, rarity: "GOLD", position: "GK", nation: "🇫🇷", baseValue: 440, dropChance:3,  image: "https://media.discordapp.net/attachments/1431997944424562738/1452596024668323892/Pekka_4.png?ex=6a365f78&is=6a350df8&hm=5dcb264cfc0da94a6628ab6e9a5d3a720cdd631a2771b944912b4f97aa1b8007&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c64", name: "Shrimp", rating: 76, rarity: "GOLD", position: "RW", nation: "🇪🇸", baseValue: 200, dropChance:6,  image: "https://media.discordapp.net/attachments/1431997944424562738/1452659198084120797/Pekka_7.png?ex=6a369a4d&is=6a3548cd&hm=93a925c2d704adee03b0cfaca7f2c351f0f233c2963789afce85df5c5e7c747e&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c65", name: "Tyler", rating: 78, rarity: "GOLD", position: "LW", nation: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", baseValue: 320, dropChance:4,  image: "https://media.discordapp.net/attachments/1431997944424562738/1452659198524653741/Pekka_8.png?ex=6a369a4e&is=6a3548ce&hm=6f4de6a6a0832a5c2911f668e3a9e4da92c0136030c8065a89b64d57b46e2d6e&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c66", name: "Inter", rating: 77, rarity: "GOLD", position: "GK", nation: "🇺🇸", baseValue: 250, dropChance:5,  image: "https://media.discordapp.net/attachments/1431997944424562738/1452662368189284373/Pekka_12.png?ex=6a369d41&is=6a354bc1&hm=bc17a89a55b18158bcc6662500300e3c8c51dcdeaa39a9cfd5b280b16358890f&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c67", name: "Card", rating: 79, rarity: "GOLD", position: "CM", nation: "🇲🇦", baseValue: 440, dropChance:4,  image: "https://media.discordapp.net/attachments/1431997944424562738/1452662369380597770/Pekka_13.png?ex=6a369d42&is=6a354bc2&hm=44881c0e9116aa38cbd04f0bd50f669193a51bcdd0adb977edfcf0316c77c4b8&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c68", name: "Panpan", rating: 83, rarity: "GOLD", position: "GK", nation: "🇸🇬", baseValue: 2400, dropChance:0.5,  image: "https://media.discordapp.net/attachments/1431997944424562738/1452662370483703970/Pekka_14.png?ex=6a369d42&is=6a354bc2&hm=30127b4175e9888ac28e41af16011f53e2323a9c0ce21af801b036df5dd79a65&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c69", name: "Maradnak", rating: 86, rarity: "TOTW", position: "GK", nation: "🇸🇰", baseValue: 14000, dropChance:0.02,  image: "https://media.discordapp.net/attachments/1431997944424562738/1453019842012774500/Maradnak_1.png?ex=6a3698ae&is=6a35472e&hm=1fab5ee875e4146e7fae7758979232bd03ee2ca000cddc495659025a96b47a73&=&format=webp&quality=lossless&width=687&height=960" },
{ id: "c70", name: "Bomisicu", rating: 86, rarity: "TOTW", position: "CM", nation: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", baseValue: 14000, dropChance:0.02,  image: "https://media.discordapp.net/attachments/1431997944424562738/1453023976124186770/Maradnak_2.png?ex=6a369c87&is=6a354b07&hm=567e32e983d1602cf0651105a52be58fcff59be30c853fbaae57a5c4b5519ee4&=&format=webp&quality=lossless&width=687&height=960" },
{ id: "c71", name: "Unknown", rating: 85, rarity: "TOTW", position: "LW", nation: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", baseValue: 8000, dropChance:0.04,  image: "https://media.discordapp.net/attachments/1431997944424562738/1453105128084209684/Unknown1.png?ex=6a363f5b&is=6a34eddb&hm=1fa769f656fa14735784e7662dc3902ee37939a662f45aa3082dd984f12b1a52&=&format=webp&quality=lossless&width=687&height=960" },
{ id: "c72", name: "Zeeshan", rating: 89, rarity: "TOTW", position: "RW", nation: "🇵🇰", baseValue: 85000, dropChance:0.0006,  image: "https://media.discordapp.net/attachments/1431997944424562738/1453108201049296987/Unknown2.png?ex=6a364238&is=6a34f0b8&hm=ea4e0733c7a2501e7686c37e188721b6d7be4171ee959e1dbfc92c665d10b752&=&format=webp&quality=lossless&width=687&height=960" },
{ id: "c73", name: "Oliver", rating: 89, rarity: "POTM", position: "RW", nation: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", baseValue: 85000, dropChance:0.0006,  image: "https://media.discordapp.net/attachments/1431997944424562738/1455170784510087250/Oliver_3_1.png?ex=6a3682e6&is=6a353166&hm=95e62bbeaf04a89b12e664efc4c22bda503950813f3d64d84d549e2b517c4094&=&format=webp&quality=lossless&width=687&height=960" },
{ id: "c74", name: "Ehzy", rating: 86, rarity: "TOTW", position: "GK", nation: "🇭🇷", baseValue: 14000, dropChance:0.02,  image: "https://media.discordapp.net/attachments/1431997944424562738/1517603056051818566/Ehzy_2_1.png?ex=6a36e17c&is=6a358ffc&hm=6677de81504d42fa600024279e3fdb17cf71da370acc81829cbcb5a90b38f48b&=&format=webp&quality=lossless&width=687&height=960" },
{ id: "c75", name: "Antonio", rating: 87, rarity: "TOTW", position: "CM", nation: "🇸🇪", baseValue: 28000, dropChance:0.005,  image: "https://media.discordapp.net/attachments/1431997944424562738/1517607596129783969/antonio_3.png?ex=6a36e5b6&is=6a359436&hm=2c3ebe72e0468d0c0ac36e47d10da8d4332a3b5c5a9403ba521795885ccf2702&=&format=webp&quality=lossless&width=687&height=960" },
{ id: "c76", name: "Seed", rating: 87, rarity: "TOTW", position: "LW", nation: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", baseValue: 28000, dropChance:0.005,  image: "https://media.discordapp.net/attachments/1431997944424562738/1517609252569743381/seed_3.png?ex=6a36e741&is=6a3595c1&hm=95b95b397bc67f22223c5cf510b8700d814bbb9b04a015afb9abc9f355226302&=&format=webp&quality=lossless&width=687&height=960" },
{ id: "c77", name: "Snickz", rating: 88, rarity: "TOTW", position: "RW", nation: "🇦🇫", baseValue: 50000, dropChance:0.003,  image: "https://media.discordapp.net/attachments/1431997944424562738/1517610674883268740/snickz_9.png?ex=6a36e894&is=6a359714&hm=47def6d1538bf729038d38d5cfceb468de6b8baf174ed2f88a26920e3f3a46f1&=&format=webp&quality=lossless&width=687&height=960" },
{ id: "c78", name: "Qerby", rating: 87, rarity: "HERO", position: "RW", nation: "🇦🇺", baseValue: 28000, dropChance:0.005,  image: "https://media.discordapp.net/attachments/1431997944424562738/1517617843926208522/qerby_1.png?ex=6a36ef41&is=6a359dc1&hm=be2fc63c29c1b9bbe6534d38598f4fc638a25bd043c78100264eae94f720a81f&=&format=webp&quality=lossless&width=687&height=960" },
{ id: "c79", name: "Leon", rating: 87, rarity: "HERO", position: "GK", nation: "🇦🇹", baseValue: 28000, dropChance:0.005,  image: "https://media.discordapp.net/attachments/1431997944424562738/1517619700966756563/leon_1.png?ex=6a36f0fc&is=6a359f7c&hm=b511b2f21b063113f88e5f16965651210e1f7def1f8d4eef2b946c7d924b77c9&=&format=webp&quality=lossless&width=687&height=960" },
{ id: "c80", name: "Jail", rating: 86, rarity: "HERO", position: "LW", nation: "🇧🇦", baseValue: 14000, dropChance:0.02,  image: "https://media.discordapp.net/attachments/1431997944424562738/1517621205769781248/jail_1.png?ex=6a36f263&is=6a35a0e3&hm=4df9972bb4890cbefde7a7010c60fee56ef7623d4de17d518af9e436402e62b7&=&format=webp&quality=lossless&width=687&height=960" },
{ id: "c81", name: "Oliver", rating: 87, rarity: "HERO", position: "RW", nation: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", baseValue: 28000, dropChance:0.005,  image: "https://media.discordapp.net/attachments/1431997944424562738/1517625674318217246/oliver_9.png?ex=6a36f68c&is=6a35a50c&hm=624ab69fa012b27f7507afe722e17ad73462947b426d771994e10c87597c094a&=&format=webp&quality=lossless&width=687&height=960" },
{ id: "c82", name: "Groton", rating: 86, rarity: "HERO", position: "GK", nation: "🇺🇸", baseValue: 14000, dropChance:0.02,  image: "https://media.discordapp.net/attachments/1431997944424562738/1517629533535207645/groton_1.png?ex=6a36fa24&is=6a35a8a4&hm=75cb4a28255249b808195765011a5bc2eed5e2bf64615f8e5eafab6623116499&=&format=webp&quality=lossless&width=687&height=960" },
{ id: "c83", name: "Benji", rating: 88, rarity: "HERO", position: "RW", nation: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", baseValue: 50000, dropChance:0.003,  image: "https://media.discordapp.net/attachments/1431997944424562738/1517631191270953030/benji_8.png?ex=6a36fbb0&is=6a35aa30&hm=9f989f78257a3177478832b7e592ee69dd5080834e0979c82f4f8d8eead164ec&=&format=webp&quality=lossless&width=687&height=960" },
{ id: "c84", name: "Djay", rating: 87, rarity: "HERO", position: "CM", nation: "🇳🇱", baseValue: 28000, dropChance:0.005,  image: "https://media.discordapp.net/attachments/1431997944424562738/1517634978941374677/djay_5.png?ex=6a38f977&is=6a37a7f7&hm=7ecc69152ed70af09f5763c45e198fa1ac05d6ac87a2eda3879e5ae26af5b297&=&format=webp&quality=lossless&width=250&height=350" },
{ id: "c85", name: "Knap", rating: 89, rarity: "HERO", position: "RW", nation: "🇸🇰", baseValue: 85000, dropChance:0.0006,  image: "https://media.discordapp.net/attachments/1431997944424562738/1517638477460668649/knap_6.png?ex=6a370279&is=6a35b0f9&hm=b81ad3a6774423de2197c204083282c222893c78d0b4e50972e3239d51b0f68a&=&format=webp&quality=lossless&width=687&height=960" },
{ id: "c86", name: "Musa", rating: 90, rarity: "ICON", position: "LW", nation: "🇵🇰", baseValue: 100000, dropChance:0.0001,  image: "https://media.discordapp.net/attachments/1431997944424562738/1517642556819898459/musa_16.png?ex=6a370645&is=6a35b4c5&hm=38dd5c4bc792f64e1f1b84adf5a6ef140df3af9b01608e0787acac848fa28952&=&format=webp&quality=lossless&width=250&height=350" },
{ id: "c87", name: "Marchiki", rating: 91, rarity: "ICON", position: "LW", nation: "🇱🇻", baseValue: 130000, dropChance:0.00006,  image: "https://media.discordapp.net/attachments/1431997944424562738/1517644843260706846/marchiki_9.png?ex=6a370867&is=6a35b6e7&hm=ff7c290bbe4e415772d5dfab395d12e4e9a49c01ddf9c207e1e8f7a3cd0fd8f2&=&format=webp&quality=lossless&width=687&height=960" },
{ id: "c88", name: "Jordi", rating: 92, rarity: "ICON", position: "RW", nation: "🇪🇸", baseValue: 175000, dropChance:0.00003,  image: "https://media.discordapp.net/attachments/1431997944424562738/1517647729780719796/jordi_3.png?ex=6a370b17&is=6a35b997&hm=8b88b6c206bcf729e5bbfd17b0a4c9d170597edc40131a1df3146523d438c5a8&=&format=webp&quality=lossless&width=687&height=960" },
{ id: "c89", name: "Ehzy", rating: 87, rarity: "Showdown", position: "GK", nation: "🇭🇷", baseValue: 28000, dropChance:0.005,  image: "https://media.discordapp.net/attachments/1431997944424562738/1518004314675613706/ehzy_4.png?ex=6a38ffef&is=6a37ae6f&hm=ee49954b292335e3ac6a06011c7354df69b144eb41a405c24dc4454683779acb&=&format=webp&quality=lossless&width=687&height=960" },
{ id: "c90", name: "Cahl", rating: 89, rarity: "Showdown_Upgradedd", position: "GK", nation: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", baseValue: 85000, dropChance:0.0006,  image: "https://media.discordapp.net/attachments/1431997944424562738/1518383362585268224/cahl_11.png?ex=6a39b833&is=6a3866b3&hm=332dac981d5ac78a730066d4fb9483c4d777af75b0b01ac2ed3a4d041b0779d3&=&format=webp&quality=lossless&width=687&height=960" },
{ id: "c91", name: "K4llx", rating: 87, rarity: "Showdown", position: "GK", nation: "🇮🇶", baseValue: 28000, dropChance:0.005,  image: "https://media.discordapp.net/attachments/1431997944424562738/1518009743719927950/k4llx_1.png?ex=6a3904fe&is=6a37b37e&hm=4e6ac6b8637dae1534e78f8396c639919f4b931dbdda8e830be0a5535b38a136&=&format=webp&quality=lossless&width=687&height=960" },
{ id: "c92", name: "Snickz", rating: 89, rarity: "Showdown_Upgraded", position: "RW", nation: "🇦🇫", baseValue: 85000, dropChance:0.0006,  image: "https://media.discordapp.net/attachments/1431997944424562738/1518013437370695850/Snickz_12_1.png?ex=6a39086e&is=6a37b6ee&hm=e9abb3f1b12becf97018c750a6c69782ec25f8664ac2515833fb18a6940220ea&=&format=webp&quality=lossless&width=687&height=960" },
{ id: "c93", name: "Knap", rating: 93, rarity: "Flashback", position: "RW", nation: "🇸🇰", baseValue: 350000, dropChance:0.000001,  image: "https://media.discordapp.net/attachments/1431997944424562738/1518002492804300891/knap_8.png?ex=6a38fe3d&is=6a37acbd&hm=aba181427e500b019b8220f297b6e9908f867b35ab57efe70118883d71bf69a5&=&format=webp&quality=lossless&width=687&height=960" },
{ id: "c94", name: "Nova", rating: 78, rarity: "GOLD", position: "LW", nation: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", baseValue: 440, dropChance:4,  image: "https://media.discordapp.net/attachments/1431997944424562738/1518374555809222666/Nova_1.png?ex=6a39b000&is=6a385e80&hm=fdeef4b3f9c002c38a3d27f9a51675cf95cefc3951eb93cdc1aecca47cde0532&=&format=webp&quality=lossless&width=687&height=960" },
{ id: "c95", name: "Nova", rating: 83, rarity: "Ones_to_watch", position: "LW", nation: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", baseValue: 2400, dropChance:0.5,  image: "https://media.discordapp.net/attachments/1431997944424562738/1518376565564637215/Nova_3.png?ex=6a39b1df&is=6a38605f&hm=85cc86baf66f4b1507755f17b3be4aa97a15de3ec86beef9328708d262244dc7&=&format=webp&quality=lossless&width=687&height=960" },
{ id: "c96", name: "Milo", rating: 85, rarity: "Ones_to_watch", position: "LW", nation: "🇸🇪", baseValue: 8000, dropChance:0.04,  image: "https://media.discordapp.net/attachments/1431997944424562738/1518381991148654602/milo_3.png?ex=6a39b6ec&is=6a38656c&hm=5d03ec584b3b149627b6cb3084f0b54f43ef9e8e5d058cb0223e023139f4e842&=&format=webp&quality=lossless&width=687&height=960" },
{ id: "c97", name: "Alex", rating: 84, rarity: "Ones_to_watch", position: "GK", nation: "🇪🇸", baseValue: 4400, dropChance:0.1,  image: "https://media.discordapp.net/attachments/1431997944424562738/1518382526157291530/alex_2.png?ex=6a39b76c&is=6a3865ec&hm=5a47a2e98da4ae9681564de9d11038f7a22c27cfc4faf52f259f7312c16814ab&=&format=webp&quality=lossless&width=687&height=960" },
{ id: "c98", name: "Mrsleepy", rating: 90, rarity: "Thunderstruck", position: "GK", nation: "🇧🇪", baseValue: 100000, dropChance:0.0001,  image: "https://media.discordapp.net/attachments/1431997944424562738/1518383984474722354/mrsleepy_5.png?ex=6a39b8c8&is=6a386748&hm=2616f77ec5c6a44083f64f0b2feb9cd4d718ac52036fe307c823075a48b2e723&=&format=webp&quality=lossless&width=687&height=960" },
{ id: "c99", name: "Benji", rating: 90, rarity: "TOTS", position: "RW", nation: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", baseValue: 100000, dropChance:0.0001,  image: "https://media.discordapp.net/attachments/1431997944424562738/1518393609349628016/benji_5.png?ex=6a39c1be&is=6a38703e&hm=c7d2decbbc5cbb14a77485b049c145dd5f28be903d12e9db344807d7ea638fbf&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c100", name: "Tacinek", rating: 96, rarity: "TOTS", position: "GK", nation: "🇵🇱", baseValue: 4400, dropChance:0.000006,  image: "https://media.discordapp.net/attachments/1431997944424562738/1518393610008268880/Tacinek_6_1.png?ex=6a39c1bf&is=6a38703f&hm=6a3f8f26d33323c6be42571afcfd3764db1ca28905653bab6fcbb68345d7f18b&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c101", name: "Peely", rating: 96, rarity: "TOTS", position: "CM", nation: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", baseValue: 4400, dropChance:0.000006,  image: "https://media.discordapp.net/attachments/1431997944424562738/1518393610771628062/peely_7.png?ex=6a39c1bf&is=6a38703f&hm=96ee0c7648038a832b4f584d5cbe4ad26f4b5551bf6fc29accdba7b7c49b8cf2&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c102", name: "Musa", rating: 96, rarity: "TOTS", position: "LW", nation: "🇵🇰", baseValue: 4400, dropChance:0.000006,  image: "https://media.discordapp.net/attachments/1431997944424562738/1518393611404840970/musa_6.png?ex=6a39c1bf&is=6a38703f&hm=b0e32314610022e836bb8b24bab8f38ff7e6512408ed7a51a182c7ea246589e1&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c103", name: "Knap", rating: 96, rarity: "TOTS", position: "RW", nation: "🇸🇰", baseValue: 4400, dropChance:0.000006,  image: "https://media.discordapp.net/attachments/1431997944424562738/1518393612356948171/knap_4.png?ex=6a39c1bf&is=6a38703f&hm=1c9426a7317b531e9dd30112eda45ecb9e3ece460fb3bc0cf48fcab3b8fe8a16&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c104", name: "Kaeg", rating: 94, rarity: "TOTS", position: "GK", nation: "🇧🇪", baseValue: 475000, dropChance:0.00001,  image: "https://media.discordapp.net/attachments/1431997944424562738/1518393613459914823/kaeg_8.png?ex=6a39c1bf&is=6a38703f&hm=208245cb8fea33ae3852a9e17726b068242033a32540ad611d772a0835935b74&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c105", name: "Djay", rating: 94, rarity: "TOTS", position: "CM", nation: "🇳🇱", baseValue: 475000, dropChance:0.00001,  image: "https://media.discordapp.net/attachments/1431997944424562738/1518393614114361455/djay_3.png?ex=6a39c1bf&is=6a38703f&hm=aa507e5353df2504261297de051abc66873c15324107b104cef3a21de0dbc30f&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c106", name: "Oliver", rating: 94, rarity: "TOTS", position: "LW", nation: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", baseValue: 475000, dropChance:0.00001,  image: "https://media.discordapp.net/attachments/1431997944424562738/1518393615112732682/oliver_7.png?ex=6a39c1c0&is=6a387040&hm=34b37258a3a3c734744208ad8cfb4b1734e44c4422507a3db737b45213c1bb8c&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c107", name: "Shadow", rating: 94, rarity: "TOTS", position: "RW", nation: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", baseValue: 475000, dropChance:0.00001,  image: "https://media.discordapp.net/attachments/1431997944424562738/1518393615536095494/shadow_3.png?ex=6a39c1c0&is=6a387040&hm=09c8b0bf01bb49221e930a4c9eaada80094b93844c11cc942505644c857a6ae5&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c108", name: "Hayden", rating: 86, rarity: "Summer_Stars", position: "CM", nation: "🏴󠁧󠁢󠁳󠁣󠁴󠁿", baseValue: 14000, dropChance:0.02,  image: "https://media.discordapp.net/attachments/1431997944424562738/1518742322316054598/Hayden_3.png?ex=6a3baf42&is=6a3a5dc2&hm=327c42cb7ca50686cbf41a412ac93f63e7950ffc8cda9bf48a3e970fa0f96456&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c109", name: "Peely", rating: 87, rarity: "Summer_Stars", position: "CM", nation: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", baseValue: 28000, dropChance:0.005,  image: "https://media.discordapp.net/attachments/1431997944424562738/1518742322672566323/Peely_12.png?ex=6a3baf42&is=6a3a5dc2&hm=0f2ff27c46ac676bfed8e841da36a79f2660bdd7e1052ce35aec8a6273f9b0d2&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c110", name: "Sub", rating: 84, rarity: "Summer_Stars", position: "CM", nation: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", baseValue: 4400, dropChance:0.2,  image: "https://media.discordapp.net/attachments/1431997944424562738/1518742323117424780/Sub_2.png?ex=6a3baf42&is=6a3a5dc2&hm=c543c74e4e25b95470c59839a14459874b93478959a5acc45071a1dadf1589a8&=&format=webp&quality=lossless&width=612&height=856" },
{ id: "c111", name: "Musta", rating: 85, rarity: "Summer_Stars", position: "GK", nation: "🇵🇰", baseValue: 8000, dropChance:0.04,  image: "https://media.discordapp.net/attachments/1431997944424562738/1518742323587055626/Musta_4.png?ex=6a3baf42&is=6a3a5dc2&hm=77aea838994ffca339848018afc3f59d235fb258cbeb40d59ceae0c315d5d161&=&format=webp&quality=lossless&width=612&height=856" }
];
/* ================= CARD MAP (FAST LOOKUPS) ================= */

// built AFTER CARDS is guaranteed valid
const cardMap = new Map(CARDS.map(c => [c.id, c]));

function sellAll(user) {
    user.club = user.club || [];
    user.favourites = user.favourites || [];

    if (user.club.length === 0) {
        return {
            success: false,
            message: "You have no cards to sell."
        };
    }

    let totalValue = 0;
    let kept = [];

    for (const owned of user.club) {
        const card = cardMap.get(owned.cardId);
        if (!card) continue;

        // 🚨 SKIP FAVOURITES
        if (user.favourites.includes(owned.instanceId)) {
            kept.push(owned);
            continue;
        }

        totalValue += Number(card.baseValue) || 0;
    }

    user.club = kept;
    user.money = (user.money || 0) + totalValue;

    return {
        success: true,
        message: `Sold all non-favourite cards for ${totalValue} coins.`
    };
}

/* ================= PACK SYSTEM ================= */

function rollCard(user) {
    const packLuck = Math.min(user?.guild?.perks?.packLuck || 0, 25);

    const pool = CARDS.map(c => ({
        card: c,
        weight: Number(c.dropChance) || 0.01
    }));

    const total = pool.reduce((sum, c) => sum + c.weight, 0);

    let roll = Math.random() * total;
    let current = 0;

    for (const entry of pool) {
        const boosted = entry.weight * (1 + packLuck / 200);
        current += boosted;

        if (roll <= current) return entry.card;
    }

    return pool[pool.length - 1].card;
}

function getAvgValue(card) {
    if (!card) return 0;

    // simple fallback system
    if (card.baseValue) return card.baseValue;

    // rating-based fallback
    return Math.floor((card.rating || 50) * 10);
}

function checkSets(user, userId, message) {
    user.completedSets ??= [];

    const owned = new Set((user.club || []).map(c => c.cardId));

    let rewards = [];

    for (const set of COLLECTION_SETS) {
        if (user.completedSets.includes(set.id)) continue;

        const hasAll = set.cards.every(id => owned.has(id));
        if (!hasAll) continue;

        user.completedSets.push(set.id);

        set.claimedBy ??= [];
        set.claimedBy.push(userId);

        let rewardText = `🏆 SET COMPLETED: ${set.name}\n\n`;

        if (set.reward?.money) {
            user.money = (user.money || 0) + set.reward.money;
            rewardText += `💰 +$${set.reward.money}\n`;
        }

        if (set.reward?.packBoost) {
            user.guildBonus = (user.guildBonus || 0) + set.reward.packBoost;
            rewardText += `📦 Pack Boost +${set.reward.packBoost}\n`;
        }

        if (set.specialCard) {
            user.club.push({
                instanceId: `${set.specialCard}_${Date.now()}_${Math.random()}`,
                cardId: set.specialCard,
                variant: "SPECIAL"
            });

            const card = CARDS.find(c => c.id === set.specialCard);

            rewardText += `⭐ SPECIAL CARD UNLOCKED:\n`;
            rewardText += `${card?.name || "Unknown"} (${card?.rating || "?"})\n`;
        }

        rewards.push(rewardText);
    }

    if (message && rewards.length) {
        message.channel.send(rewards.join("\n"));
    }

    return rewards.length > 0;
}

function normalize(str) {
    return String(str || "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
}

function getName(cardId) {
    if (!cardId) return "Empty";

    const card = cardMap.get(cardId);

    if (!card) return "Unknown";

    return `${card.name} (${card.rating})`;
}

function isLineupReady(lineup) {
    if (!lineup) return false;

    const hasGK = !!lineup.GK;
    const hasLW = !!lineup.LW;
    const hasRW = !!lineup.RW;

    const cmCount = (lineup.CM1 ? 1 : 0) + (lineup.CM2 ? 1 : 0);

    return hasGK && hasLW && hasRW && cmCount === 2;
}

function createAuction({ sellerId, item, price, duration }) {
    const auction = {
        id: Date.now(),
        seller: sellerId,

        item, // FULL ITEM STORED HERE (IMPORTANT FIX)

        startPrice: price,
        currentBid: price,
        highestBidder: null,

        highestBidderId: null,

        bids: new Map(), // escrow tracking

        endTime: Date.now() + duration * 1000,
        active: true
    };

    auctions.push(auction);
    return auction;
}

function safeNumber(n, fallback = 0) {
    n = Number(n);
    return Number.isFinite(n) ? n : fallback;
}

function cleanGuild(user) {
    if (user.guild && !guilds[user.guild]) {
        user.guild = null;
        user.guildRole = null;
    }
}

/* ================= BOT ================= */

client.on("messageCreate", async (message) => {
    try {
        console.log("MESSAGE RECEIVED:", message.content);
        console.log("RAW:", message.content);

        if (message.author.bot) return;
        if (!message.content.startsWith("/")) return;

        const user = getUser(message.author.id);

        const parts = message.content.trim().split(/\s+/);
        const cmd = parts[0]?.toLowerCase();
        const args = parts.slice(1);

        console.log("CMD:", cmd);

 // ================= VIEWCARD =================
if (cmd === "/viewcard") {
    const query = args.join(" ").toLowerCase().trim();

    if (!query) {
        return message.channel.send("❌ Use: /viewcard <player name>");
    }

    const matches = CARDS.filter(c =>
        c.name.toLowerCase().includes(query)
    );

    if (matches.length === 0) {
        return message.channel.send("❌ Not found");
    }

    // Single match → show embed
    if (matches.length === 1) {
        const card = matches[0];

        const embed = {
            title: `🎴 ${card.name}`,
            fields: [
                {
                    name: "⭐ Rating",
                    value: String(card.rating),
                    inline: true
                },
                {
                    name: "📍 Position",
                    value: card.position || "N/A",
                    inline: true
                },
                {
                    name: "🏳 Nation",
                    value: card.nation || "N/A",
                    inline: true
                },
                {
                    name: "✨ Rarity",
                    value: card.rarity || "NORMAL",
                    inline: true
                }
            ]
        };

        if (card.image) {
            embed.image = {
                url: card.image
            };
        }

        return message.channel.send({
            embeds: [embed]
        });
    }

    // Multiple matches → choose one
    pendingView[message.author.id] = {
        cards: matches
    };

    let text = "⚠️ Multiple cards found:\n\n";

    matches.forEach((c, i) => {
        text += `${i + 1}. ${c.name} (${c.rating})\n`;
    });

    text += "\n👉 Use: /selectview <number>";

    return message.channel.send(text);
}

if (cmd === "/selectview") {
    try {
        const pending = pendingView[message.author.id];

        if (!pending) {
            return message.channel.send("❌ No pending view found.");
        }

        const index = Number(args[0]) - 1;

        if (!Number.isInteger(index)) {
            return message.channel.send("❌ Use: /selectview <number>");
        }

        const card = pending.cards[index];

        if (!card) {
            return message.channel.send("❌ Invalid selection.");
        }

        delete pendingView[message.author.id];

        const embed = {
            title: `🎴 ${card.name}`,
            fields: [
                { name: "⭐ Rating", value: String(card.rating), inline: true },
                { name: "📍 Position", value: card.position || "N/A", inline: true },
                { name: "🏳 Nation", value: card.nation || "N/A", inline: true },
                { name: "✨ Rarity", value: card.rarity || "NORMAL", inline: true }
            ]
        };

        if (card.image) {
            embed.image = { url: card.image };
        }

        return message.channel.send({ embeds: [embed] });

    } catch (err) {
        console.error("SELECTVIEW CRASH:", err);
        return message.channel.send("❌ Selectview crashed.");
    }
}

        // ================= OPEN CARD =================
if (cmd === "/openpack") {
    try {
        user.money = Number(user.money) || 0;
        user.club = user.club || [];
        user.packsOpened = Number(user.packsOpened) || 0;

        const cost = 200;

        if (user.money < cost) {
            return message.channel.send("❌ Need $200.");
        }

        if (playCooldown.has(message.author.id)) {
            return message.channel.send("⏳ Wait 1 second before opening another pack.");
        }

        playCooldown.add(message.author.id);
        setTimeout(() => playCooldown.delete(message.author.id), 1000);

        user.money -= cost;
        user.packsOpened++;

        const card = rollCard(user);

        if (!card) {
            return message.channel.send("❌ Card roll failed.");
        }

        const isRare =
            ["ICON", "TOTW", "POTM", "HERO", "Future_Stars", "Showdown", "Showdown_Upgraded", "Flashback", "Thunderstruck", "Ones_to_watch", "TOTS", "Summer_Stars", "FUT_Birthday", "Joga Bonito", "Future_Stars"].includes(card.rarity) ||
            card.rating >= 85;

        if (isRare && RARE_WEBHOOK_URL) {
            axios.post(RARE_WEBHOOK_URL, {
                content: `🔥 <@${message.author.id}>`,
                embeds: [{
                    title: "🎁 RARE PACK OPENED",
                    color: 0x00ffcc,
                    description:
`🎴 Player: ${card.name}
💯 Rating: ${card.rating}
📍 Position: ${card.position}
🏳 Nation: ${card.nation}
⭐ Rarity: ${card.rarity}
🎯 Drop Chance: ${card.dropChance}%`,
                    image: {
                        url: card.image
                    }
                }]
            }).catch(err => console.error("Webhook error:", err));
        }

        const instanceId =
            `${card.id}_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;

        user.club.push({
            instanceId,
            cardId: card.id,
            variant: "GOLD"
        });

        checkCollections(user);
saveData?.();

        globalExists[card.id] = (globalExists[card.id] || 0) + 1;

        const avgValue = getAvgValue(card) || card.baseValue || 100;

        const owned = user.club.filter(
            c => c.cardId === card.id
        ).length;

        saveData();

        return message.channel.send({
            embeds: [{
                title: "🎁 PACK OPENED",
                color: 0x00ffcc,
                description:
`🎴 Player: ${card.name}
💯 Rating: ${card.rating}
📍 Position: ${card.position}
🏳 Nation: ${card.nation}
⭐ Rarity: ${card.rarity}
🎯 Drop Chance: ${card.dropChance}%

💰 Market Avg: $${avgValue}
📊 Owned: ${owned}
🌍 Global Exist: ${globalExists[card.id]}`,
                image: {
                    url: card.image
                }
            }]
        });

    } catch (err) {
        console.error("OPENPACK CRASH:", err);
        return message.channel.send("❌ Openpack crashed.");
    }
}

//-----------BALANCE-----------//
 if (cmd === "/balance") {
            user.money = Number(user.money) || 0;
            user.packsOpened = Number(user.packsOpened) || 0;

            return message.channel.send(
                `💰 Balance: $${user.money}\n📦 Packs: ${user.packsOpened}`
            );
        }

//----------SELL-----------//

if (cmd === "/sellall") {
    const result = sellAll(user);
    return message.channel.send(result.message);
}


if (cmd === "/sell") {
    try {
        user.club = user.club || [];

        const parts = message.content.trim().split(/\s+/);

        if (parts.length < 3) {
            return message.channel.send("❌ Use: /sell <player name> <amount>");
        }

        const amount = Number(parts[parts.length - 1]);

        if (!Number.isFinite(amount) || amount <= 0) {
            return message.channel.send("❌ Invalid amount.");
        }

        const nameQuery = normalize(parts.slice(1, -1).join(" "));

        const matches = user.club.filter(item => {
            const card = cardMap.get(item.cardId);
            return card && normalize(card.name).includes(nameQuery);
        });

        if (matches.length === 0) {
            return message.channel.send("❌ You don’t own this player.");
        }

        const uniqueCards = new Map();

        for (const item of matches) {
            const card = cardMap.get(item.cardId);
            if (!card) continue;

            if (!uniqueCards.has(card.id)) {
                uniqueCards.set(card.id, {
                    card,
                    items: []
                });
            }

            uniqueCards.get(card.id).items.push(item);
        }

        const groups = [...uniqueCards.values()];

        // ================= SINGLE TYPE =================
        if (groups.length === 1) {
            const group = groups[0];

            if (group.items.length < amount) {
                return message.channel.send("❌ Not enough copies.");
            }

            const removed = group.items.slice(0, amount);
            const removeSet = new Set(removed.map(r => r.instanceId));

            user.club = user.club.filter(c => !removeSet.has(c.instanceId));

            let price = (group.card.baseValue || 100) * amount;

            const guild = user.guild ? guilds[user.guild] : null;
            const moneyBoost = guild?.perks?.moneyBoost || 0;

            price = Math.floor(price * (1 + moneyBoost / 100));

            user.money = (user.money || 0) + price;

            saveData?.();

            return message.channel.send(
                `💰 Sold ${amount}x **${group.card.name} (${group.card.rating})** for **$${price}**`
            );
        }

        // ================= MULTI TYPE =================
        pendingSell[message.author.id] = { amount, groups };

        let text = "⚠️ Multiple versions found:\n\n";

        groups.forEach((g, i) => {
            const card = g.card;

            text += `#${i + 1} ${card.name}\n`;
            text += `⭐ Rating: ${card.rating}\n`;
            text += `📍 Position: ${card.position}\n`;
            text += `🏷 Rarity: ${card.rarity || "NORMAL"}\n`;
            text += `💰 Base Value: $${card.baseValue || 100}\n`;
            text += `📦 Owned: ${g.items.length}\n\n`;
        });

        text += "➡️ Use: /selectsell <number>";

        return message.channel.send(text);

    } catch (err) {
        console.error("SELL CRASH:", err);
        return message.channel.send("❌ Sell crashed.");
    }
}

if (cmd === "/selectsell") {
    try {
        const pending = pendingSell[message.author.id];

        if (!pending) {
            return message.channel.send("❌ No pending sell found.");
        }

        const index = Number(args[0]) - 1;

        if (!Number.isInteger(index)) {
            return message.channel.send("❌ Use: /selectsell <number>");
        }

        const group = pending.groups[index];

        if (!group) {
            return message.channel.send("❌ Invalid selection.");
        }

        const amount = pending.amount;

        if (group.items.length < amount) {
            return message.channel.send("❌ Not enough copies.");
        }

        const removed = group.items.slice(0, amount);
        const removeSet = new Set(removed.map(r => r.instanceId));

        user.club = user.club.filter(c => !removeSet.has(c.instanceId));

        let price = (group.card.baseValue || 100) * amount;

        const guild = user.guild ? guilds[user.guild] : null;
        const boost = guild?.perks?.moneyBoost || 0;

        price = Math.floor(price * (1 + boost / 100));

        user.money = (user.money || 0) + price;

        delete pendingSell[message.author.id];

        saveData?.();

        return message.channel.send(
            `💰 Sold ${amount}x **${group.card.name} (${group.card.rating})** for **$${price}**`
        );

    } catch (err) {
        console.error("SELECTSELL CRASH:", err);
        return message.channel.send("❌ Selectsell crashed.");
    }
}

//--------CLUB--------------//

if (cmd === "/club") {
    try {
        user.club = user.club || [];
        user.lineup = user.lineup || {};

        if (user.club.length === 0) {
            return message.channel.send("📦 Your club is empty.");
        }

        const counts = {};

        for (const item of user.club) {
            if (!item?.cardId) continue;
            counts[item.cardId] = (counts[item.cardId] || 0) + 1;
        }

        let text = "📦 YOUR CLUB\n\n";

        for (const cardId in counts) {
            const card = cardMap.get(cardId);
            if (!card) continue;

            const inLineup = Object.values(user.lineup).includes(cardId);

            text += `${counts[cardId]}x ${card.name} | ${card.position} | ${card.rating} OVR ${inLineup ? "⭐ (IN LINEUP)" : ""}\n`;
        }

        return message.channel.send(text);

    } catch (err) {
        console.error("CLUB CRASH:", err);
        return message.channel.send("❌ Club command crashed.");
    }
}

//-------------LEADERBOARDS-----------//
if (cmd === "/leaderboard") {
    try {
        const type = args[0];
        const all = Object.entries(users);

        if (type === "money") {
            const sorted = all
                .map(([id, u]) => ({
                    id,
                    money: Number(u.money) || 0
                }))
                .sort((a, b) => b.money - a.money)
                .slice(0, 10);

            let text = "🏆 **GLOBAL LEADERBOARD (BALANCE)**\n\n";

            sorted.forEach((u, i) => {
                text += `#${i + 1} <@${u.id}> — $${u.money}\n`;
            });

            return message.channel.send(text);
        }

        if (type === "cards") {
            const sorted = all
                .map(([id, u]) => ({
                    id,
                    cards: Array.isArray(u.club) ? u.club.length : 0
                }))
                .sort((a, b) => b.cards - a.cards)
                .slice(0, 10);

            let text = "🎴 **GLOBAL LEADERBOARD (CARDS)**\n\n";

            sorted.forEach((u, i) => {
                text += `#${i + 1} <@${u.id}> — ${u.cards} cards\n`;
            });

            return message.channel.send(text);
        }

        if (type === "packs") {
            const sorted = all
                .map(([id, u]) => ({
                    id,
                    packs: Number(u.packsOpened) || 0
                }))
                .sort((a, b) => b.packs - a.packs)
                .slice(0, 10);

            let text = "📦 **GLOBAL LEADERBOARD (PACKS OPENED)**\n\n";

            sorted.forEach((u, i) => {
                text += `#${i + 1} <@${u.id}> — ${u.packs} packs\n`;
            });

            return message.channel.send(text);
        }

        return message.channel.send("❌ Usage: /leaderboard money | cards | packs");

    } catch (err) {
        console.error("LEADERBOARD ERROR:", err);
        return message.channel.send("❌ Leaderboard crashed.");
    }
}


        // ================= COLLECTION =================
if (cmd === "/collection") {
    try {
        user.club = user.club || [];

        // ---- SETS ----
        const sets = {
            japanTrio: {
                name: "🇯🇵 Japan Trio",
                cards: ["c83", "c84", "c85"],
                rewardCard: "c93" // 93 Knap
            },
             TheFront3: {
        name: "The Front three",
        cards: ["c85", "c86", "c81"],
        rewardCard: "c88"
    }
        };

        const ownedSet = new Set(user.club.map(c => c.cardId));

        let text = "📚 COLLECTION PROGRESS\n\n";

        for (const key in sets) {
            const set = sets[key];

            let owned = 0;
            let missing = [];

            for (const cardId of set.cards) {
                const card = cardMap.get(cardId);

                // 🔴 if card doesn't exist, skip but DON'T mark as owned
                if (!card) {
                    missing.push({
                        name: "UNKNOWN CARD",
                        rating: "???",
                        id: cardId
                    });
                    continue;
                }

                if (ownedSet.has(cardId)) {
                    owned++;
                } else {
                    missing.push(card);
                }
            }

            const total = set.cards.length;
            const percent = Math.floor((owned / total) * 100);

            text += `🏆 ${set.name}\n`;
            text += `Progress: ${owned}/${total} (${percent}%)\n\n`;

            // ---- MISSING PLAYERS ----
            if (missing.length > 0) {
                text += "❌ Missing Players:\n";

                for (const m of missing) {
                    text += `- ${m.name} | ${m.rating} OVR\n`;
                }

                text += "\n";
            } else {
                text += "✅ SET COMPLETE!\n\n";
            }

            // ---- REWARD ----
            const reward = cardMap.get(set.rewardCard);

            if (reward) {
                text += `🎁 Reward: ${reward.name} (${reward.rating} OVR)\n`;
            }

            text += "\n----------------------\n\n";
        }

        return message.channel.send(text);

    } catch (err) {
        console.error("COLLECTION ERROR:", err);
        return message.channel.send("❌ Collection crashed.");
    }
}

if (cmd === "/favourites") {
    try {
        user.favourites = user.favourites || [];

        if (user.favourites.length === 0) {
            return message.channel.send("⭐ You have no favourite players.");
        }

        let text = "⭐ YOUR FAVOURITE PLAYERS\n\n";

        for (const instanceId of user.favourites) {
            const ownedCard = user.club.find(c => c.instanceId === instanceId);

            if (!ownedCard) {
                text += `❌ Missing card (may have been sold)\n\n`;
                continue;
            }

            const card = cardMap.get(ownedCard.cardId);

            if (!card) {
                text += `❌ Unknown card\n\n`;
                continue;
            }

            text += `🎴 ${card.name}\n`;
            text += `⭐ ${card.rating} OVR\n`;
            text += `📍 ${card.position}\n`;
            text += `🏷 ${card.rarity || "NORMAL"}\n\n`;
        }

        return message.channel.send(text);

    } catch (err) {
        console.error("FAVOURITES LIST ERROR:", err);
        return message.channel.send("❌ Could not load favourites.");
    }
}

if (cmd === "/favourite") {
    try {
        const cardId = args[0];

        if (!cardId) {
            return message.channel.send("❌ Usage: /favourite <cardId>");
        }

        user.favourite = cardId;

        saveData?.();

        return message.channel.send("⭐ Favourite card set!");

    } catch (err) {
        console.error("FAVOURITE ERROR:", err);
        return message.channel.send("❌ Failed to set favourite.");
    }

    // store temporary selection
    pendingFavourite[message.author.id] = matches;

    let text = "⭐ Multiple copies found:\n\n";

    matches.forEach((item, i) => {
        const card = cardMap.get(item.cardId);

        text += `#${i + 1}\n`;
        text += `${card.name} | ${card.rating}\n`;
        text += `Instance: ${item.instanceId}\n\n`;
    });

    text += "➡️ Use: /selectfav <number>";

    return message.channel.send(text);
}

if (cmd === "/favourite") {
    user.club = user.club || [];
    user.favourites = user.favourites || [];

    const query = args.join(" ").toLowerCase().trim();

    if (!query) {
        return message.channel.send("❌ Use: /favourite <player name>");
    }

    const matches = user.club.filter(item => {
        const card = cardMap.get(item.cardId);
        return card && card.name.toLowerCase().includes(query);
    });

    if (matches.length === 0) {
        return message.channel.send("❌ No matching players found.");
    }

    // store temporary selection
    pendingFavourite[message.author.id] = matches;

    let text = "⭐ Multiple copies found:\n\n";

    matches.forEach((item, i) => {
        const card = cardMap.get(item.cardId);

        text += `#${i + 1}\n`;
        text += `${card.name} | ${card.rating}\n`;
        text += `Instance: ${item.instanceId}\n\n`;
    });

    text += "➡️ Use: /selectfav <number>";

    return message.channel.send(text);
}

if (cmd === "/selectfav") {
    try {
        user.favourites = user.favourites || [];

        const pending = pendingFavourite[message.author.id];

        if (!pending) {
            return message.channel.send("❌ No pending favourites found. Use /favourite first.");
        }

        const index = Number(args[0]) - 1;

        if (!Number.isInteger(index)) {
            return message.channel.send("❌ Use: /selectfav <number>");
        }

        const item = pending[index];

        if (!item) {
            return message.channel.send("❌ Invalid selection.");
        }

        // prevent duplicates
        if (user.favourites.includes(item.instanceId)) {
            return message.channel.send("⭐ This card is already a favourite.");
        }

        user.favourites.push(item.instanceId);

        // cleanup
        delete pendingFavourite[message.author.id];

        saveData?.();

        const card = cardMap.get(item.cardId);

        return message.channel.send(
            `⭐ Added to favourites: **${card.name} (${card.rating})**`
        );

    } catch (err) {
        console.error("SELECTFAV ERROR:", err);
        return message.channel.send("❌ Selectfav crashed.");
    }
}

if (cmd === "/unfavourite") {
    try {
        user.favourites = user.favourites || [];

        const query = args.join(" ").toLowerCase().trim();

        const match = user.club.find(item => {
            const card = cardMap.get(item.cardId);
            return card && card.name.toLowerCase().includes(query);
        });

        if (!match) {
            return message.channel.send("❌ Player not found.");
        }

        user.favourites = user.favourites.filter(id => id !== match.instanceId);

        saveData?.();

        return message.channel.send(`❌ Removed from favourites.`);

    } catch (err) {
        console.error(err);
        return message.channel.send("❌ Unfavourite crashed.");
    }
}

        // ================= CHECKSETS =================
   
checkSets(user, message.author.id, message);

      // ================= LINEUP ADD =================
if (cmd === "/lineup" && !args[0]) {
    try {
        user.lineup = user.lineup || {};

        const slots = ["GK", "CM1", "CM2", "LW", "RW"];

        const format = (slot) => {
            if (!slot) return "Empty";

            const cardId = slot.cardId || slot;
            const card = cardMap.get(cardId);

            if (!card) return "Unknown";

            return `${card.name} | ${card.rating} OVR`;
        };

        let text = "⚽ LINEUP\n\n";

        for (const s of slots) {
            text += `${s}: ${format(user.lineup[s])}\n`;
        }

        return message.channel.send(text);

    } catch (err) {
        console.error("LINEUP ERROR:", err);
        return message.channel.send("❌ Lineup crashed.");
    }
}

  if (cmd === "/lineup" && args[0] === "add") {
    try {
        user.club = user.club || [];
        user.lineup = user.lineup || {};

        const role = args[1]?.toUpperCase();
        const nameQuery = args.slice(2).join(" ").toLowerCase().trim();

        if (!role || !nameQuery) {
            return message.channel.send("❌ Use: /lineup add <ROLE> <PLAYER>");
        }

        const valid = ["GK", "CM", "LW", "RW"];
        if (!valid.includes(role)) {
            return message.channel.send("❌ Invalid role");
        }

        const matches = user.club.filter(i => {
            const c = cardMap.get(i.cardId);
            return c && normalize(c.name).includes(nameQuery);
        });

        if (!matches.length) {
            return message.channel.send("❌ You don’t own this player.");
        }

        const selected = matches[0];

        const slot = {
            cardId: selected.cardId,
            instanceId: selected.instanceId
        };

        if (role === "CM") {
            if (!user.lineup.CM1) user.lineup.CM1 = slot;
            else if (!user.lineup.CM2) user.lineup.CM2 = slot;
            else return message.channel.send("❌ CM full");
        } else {
            user.lineup[role] = slot;
        }

        saveData?.();
        return message.channel.send(`✅ Added ${cardMap.get(selected.cardId)?.name || "Player"}`);

    } catch (err) {
        console.error("LINEUP ADD ERROR:", err);
        return message.channel.send("❌ Lineup add crashed.");
    }
}


      if (cmd === "/lineup" && args[0] === "remove") {
    try {
        user.lineup = user.lineup || {};

        const slot = args[1]?.toUpperCase();
        const valid = ["GK", "CM1", "CM2", "LW", "RW"];

        if (!valid.includes(slot)) {
            return message.channel.send("❌ Use GK/CM1/CM2/LW/RW");
        }

        if (!user.lineup[slot]) {
            return message.channel.send("❌ Slot already empty");
        }

        user.lineup[slot] = null;

        saveData?.();
        return message.channel.send(`🧹 Removed ${slot}`);

    } catch (err) {
        console.error("REMOVE ERROR:", err);
        return message.channel.send("❌ Remove crashed.");
    }
}


        // ================= VIEW =================
     const l = user.lineup || {};

function format(slot) {
    if (!slot) return "Empty";

    const cardId = typeof slot === "string"
        ? slot
        : slot.cardId;

    const card = cardMap.get(cardId);

    if (!card) return "Unknown";

    return `${card.name} | ${card.rating} OVR`;
}

if (cmd === "/autolineup") {
    try {
        user.club = user.club || [];
        user.lineup = user.lineup || {};

        const slots = {
            GK: null,
            CM1: null,
            CM2: null,
            LW: null,
            RW: null
        };

        const used = new Set();

        const getBest = (pos) => {
            let best = null;

            for (const item of user.club) {
                if (used.has(item.instanceId)) continue;

                const card = cardMap.get(item.cardId);
                if (!card || card.position !== pos) continue;

                if (!best) {
                    best = item;
                } else {
                    const bestCard = cardMap.get(best.cardId);
                    if (card.rating > bestCard.rating) {
                        best = item;
                    }
                }
            }

            if (best) used.add(best.instanceId);

            return best
                ? { cardId: best.cardId, instanceId: best.instanceId }
                : null;
        };

        slots.GK = getBest("GK");
        slots.CM1 = getBest("CM");
        slots.CM2 = getBest("CM");
        slots.LW = getBest("LW");
        slots.RW = getBest("RW");

        user.lineup = slots;

        saveData?.();

        const format = (slot) => {
            if (!slot) return "Empty";

            const card = cardMap.get(slot.cardId);
            if (!card) return "Unknown";

            return `${card.name} | ${card.rating} OVR`;
        };

        const text =
`⚡ BEST LINEUP BUILT

GK: ${format(slots.GK)}
CM1: ${format(slots.CM1)}
CM2: ${format(slots.CM2)}
LW: ${format(slots.LW)}
RW: ${format(slots.RW)}`;

        return message.channel.send(text);

    } catch (err) {
        console.error("AUTOLINEUP ERROR:", err);
        return message.channel.send("❌ Auto lineup crashed.");
    }
}
    

function format(slot) {
    if (!slot) return "Empty";

    const cardId = typeof slot === "string"
        ? slot
        : slot.cardId;

    const card = cardMap.get(cardId);

    if (!card) return "Unknown";

    return `${card.name} | ${card.rating} OVR`;
}





if (cmd === "/selectlineup") {
    try {
        const data = pendingLineup[message.author.id];
        if (!data) return message.channel.send("❌ No pending selection.");

        const index = Number(args[0]) - 1;
        const selected = data.matches[index];

        if (!selected) return message.channel.send("❌ Invalid selection.");

        const card = cardMap.get(selected.cardId);
        if (!card) return message.channel.send("❌ Missing card");

        const slot = {
            cardId: selected.cardId,
            instanceId: selected.instanceId
        };

        if (data.role === "CM") {
            if (!user.lineup.CM1) user.lineup.CM1 = slot;
            else if (!user.lineup.CM2) user.lineup.CM2 = slot;
            else return message.channel.send("❌ CM full");
        } else {
            user.lineup[data.role] = slot;
        }

        delete pendingLineup[message.author.id];

        saveData?.();
        return message.channel.send(`✅ Added ${card.name}`);

    } catch (err) {
        console.error("SELECT LINEUP ERROR:", err);
        return message.channel.send("❌ Select lineup crashed.");
    }
}

// ================= TEAM RATING =================
function getTeamRating(lineup) {
    let total = 0;
    let count = 0;

    for (const key in lineup) {
        const slot = lineup[key];
        if (!slot) continue;

        const cardId = slot.cardId || slot;
        const card = cardMap.get(cardId);
        if (!card) continue;

        total += Number(card.rating) || 0;
        count++;
    }

    return count ? Math.floor(total / count) : 0;
}
        //-------------play-----------//
        if (cmd === "/play") {
    try {
        const target = message.mentions.users.first();
        if (!target) return message.channel.send("⚠️ Use: /play @user");

        const opp = getUser(target.id);

        if (!isLineupReady(user.lineup)) {
            return message.channel.send("❌ You don’t have a full lineup.");
        }

        if (!isLineupReady(opp.lineup)) {
            return message.channel.send("❌ Opponent has no full lineup.");
        }

        // ================= HELPERS =================

        const getCard = (slot) => {
            const id = slot?.cardId || slot;
            return cardMap.get(id);
        };

        const lineupCards = (lineup) =>
            Object.values(lineup)
                .map(getCard)
                .filter(Boolean);

        const avg = (arr, key) =>
            arr.reduce((a, b) => a + (b[key] || 0), 0) / arr.length;

        // ================= TEAM STATS =================

        const yourCards = lineupCards(user.lineup);
        const oppCards = lineupCards(opp.lineup);

        const yourRating = getTeamRating(user.lineup);
        const oppRating = getTeamRating(opp.lineup);

        // split rating into attack/defense (fake but effective realism)
        const yourAttack = avg(yourCards, "rating") * 0.6 + yourRating * 0.4;
        const yourDefense = avg(yourCards, "rating") * 0.5 + yourRating * 0.5;

        const oppAttack = avg(oppCards, "rating") * 0.6 + oppRating * 0.4;
        const oppDefense = avg(oppCards, "rating") * 0.5 + oppRating * 0.5;

        // ================= CHEMISTRY SYSTEM =================
        const calcChemistry = (lineup) => {
            const positions = Object.values(lineup).map(getCard).filter(Boolean);
            const ratings = positions.map(p => p.rating);

            const variance =
                ratings.reduce((a, b) => a + Math.abs(b - yourRating), 0) / ratings.length;

            return Math.max(0.7, 1 - variance / 200); // 0.7 - 1.0 multiplier
        };

        const yourChem = calcChemistry(user.lineup);
        const oppChem = calcChemistry(opp.lineup);

        // ================= MATCH CONTROL =================

        let yourControl = yourRating * yourChem;
        let oppControl = oppRating * oppChem;

        let yourGoals = 0;
        let oppGoals = 0;

        const events = [];

        const randomPlayer = (lineup, allowGK = false) => {
    const players = Object.values(lineup)
        .map(slot => {
            const cardId = slot?.cardId || slot;
            return cardMap.get(cardId);
        })
        .filter(Boolean)
        .filter(p => allowGK || p.position !== "GK");

    return players[Math.floor(Math.random() * players.length)];
};

        // ================= MATCH PHASES =================

        for (let minute = 1; minute <= 90; minute++) {

            // momentum shifts every 15 mins
            if (minute % 15 === 0) {
                const swing = (Math.random() - 0.5) * 10;
                yourControl += swing;
                oppControl -= swing;
            }

            const total = yourControl + oppControl;
            const yourChance = yourControl / total;

            // attack chance per minute
            if (Math.random() < 0.08) {

                const attackingSide = Math.random() < yourChance ? "you" : "opp";

                const attacker =
                    attackingSide === "you"
                        ? yourAttack
                        : oppAttack;

                const defender =
                    attackingSide === "you"
                        ? oppDefense
                        : yourDefense;

                const shotQuality =
                    (attacker / (defender || 1)) + Math.random();

                // GK factor
                const gkSaveBoost = 0.2;

                const goalChance = shotQuality * 0.25;

                if (Math.random() < goalChance) {

                    const scorer =
                        attackingSide === "you"
                            ? randomPlayer(user.lineup)
                            : randomPlayer(opp.lineup);

                    if (scorer) {
                        events.push({
                            minute,
                            text: `⚽ ${scorer.name} scores for ${attackingSide === "you" ? message.author.username : target.username}`
                        });

                        if (attackingSide === "you") yourGoals++;
                        else oppGoals++;
                    }

                } else if (Math.random() < gkSaveBoost) {

                    const gk =
                        attackingSide === "you"
                            ? getCard(opp.lineup.GK)
                            : getCard(user.lineup.GK);

                    if (gk) {
                        events.push({
                            minute,
                            text: `🧤 ${gk.name} makes a crucial save`
                        });
                    }
                }
            }

            // random fouls
            if (Math.random() < 0.01) {
                const p = randomPlayer(Math.random() < 0.5 ? user.lineup : opp.lineup);
                if (p) {
                    events.push({
                        minute,
                        text: `🟨 ${p.name} booked`
                    });
                }
            }
        }

        // ================= MAN OF THE MATCH =================

        const scorers = events.filter(e => e.text.startsWith("⚽"));

        let motm =
            scorers.length > 0
                ? scorers[Math.floor(Math.random() * scorers.length)].text.split(" scores")[0].replace("⚽ ", "")
                : randomPlayer(Math.random() < 0.5 ? user.lineup : opp.lineup)?.name || "Unknown";

        // ================= RESULT =================

        events.sort((a, b) => a.minute - b.minute);

        let result =
`⚔️ MATCH RESULT

👤 ${message.author.username} ${yourGoals} - ${oppGoals} ${target.username}

📊 Ratings
${message.author.username}: ${yourRating}
${target.username}: ${oppRating}

🧠 Chemistry
${message.author.username}: ${(yourChem * 100).toFixed(0)}%
${target.username}: ${(oppChem * 100).toFixed(0)}%

📜 EVENTS
`;

        if (events.length === 0) result += "No major events.\n";
        else events.forEach(e => result += `${e.minute}' ${e.text}\n`);

        result += `\n⭐ Man of the Match: ${motm}\n`;

        if (yourGoals > oppGoals) {
            user.money = (user.money || 0) + 120;
            result += "\n🏆 You Win! (+120 coins)";
        } else if (yourGoals < oppGoals) {
            result += "\n💀 You Lose!";
        } else {
            user.money = (user.money || 0) + 40;
            result += "\n🤝 Draw! (+40 coins)";
        }

        saveData?.();

        return message.channel.send(result);

    } catch (err) {
        console.error("PLAY ULTRA CRASH:", err);
        return message.channel.send("❌ Match crashed.");
    }
}


       // ================= MARKET VIEW =================
if (cmd === "/market" && args[0] === "view") {
    try {
        if (!Array.isArray(marketListings) || marketListings.length === 0) {
            return message.channel.send("❌ Market is empty.");
        }

        let text = "🏪 MARKET LISTINGS\n\n";

        for (const m of marketListings) {
            if (!m?.item?.cardId) continue;

            const card = cardMap.get(m.item.cardId);
            if (!card) continue;

            text +=
`ID: ${m.id}
🎴 ${card.name}
💰 Price: $${m.price}

`;
        }

        return message.channel.send(text || "❌ No valid listings.");

    } catch (err) {
        console.error("MARKET VIEW ERROR:", err);
        return message.channel.send("❌ Market crashed.");
    }
}

     if (cmd === "/market" && args[0] === "sell") {
    try {
        user.club = user.club || [];

        const price = Number(args[args.length - 1]);
        const nameQuery = args.slice(1, -1).join(" ").toLowerCase().trim();

        if (!nameQuery) {
            return message.channel.send("❌ Use: /market sell <player> <price>");
        }

        if (!Number.isFinite(price) || price <= 0) {
            return message.channel.send("❌ Invalid price.");
        }

        const matches = user.club.filter(c => {
            const card = cardMap.get(c.cardId);
            return card && card.name.toLowerCase().includes(nameQuery);
        });

        if (!matches.length) {
            return message.channel.send("❌ You don't own that player.");
        }

        const item = matches[0];

        // remove item from club (lock it into market)
        user.club = user.club.filter(c => c.instanceId !== item.instanceId);

        const listing = {
            id: Date.now(),
            seller: message.author.id,
            item,
            price
        };

        marketListings = marketListings || [];
        marketListings.push(listing);

        saveData?.();

        return message.channel.send(
            `🏪 Listed **${cardMap.get(item.cardId)?.name || "Unknown"}** for $${price} (ID: ${listing.id})`
        );

    } catch (err) {
        console.error("MARKET SELL CRASH:", err);
        return message.channel.send("❌ Market failed.");
    }
}

      if (cmd === "/market" && args[0] === "buy") {
    try {
        user.club = user.club || [];
        user.money = Number(user.money) || 0;
        marketListings = marketListings || [];

        const id = Number(args[1]);

        if (!Number.isFinite(id)) {
            return message.channel.send("❌ Invalid listing ID.");
        }

        const listing = marketListings.find(m => m.id === id);

        if (!listing) {
            return message.channel.send("❌ Listing not found.");
        }

        if (listing.seller === message.author.id) {
            return message.channel.send("❌ You can't buy your own item.");
        }

        if (user.money < listing.price) {
            return message.channel.send("❌ Not enough money.");
        }

        const seller = getUser(listing.seller);
        seller.money = Number(seller.money) || 0;

        // 💰 transfer money
        user.money -= listing.price;
        seller.money += listing.price;

        // 🎴 give item (clone to avoid reference bugs)
        user.club.push({
            instanceId: `${listing.item.instanceId}_${Date.now()}`,
            cardId: listing.item.cardId,
            variant: listing.item.variant || "MARKET"
        });

        // remove listing
        marketListings = marketListings.filter(m => m.id !== id);

        saveData?.();

        return message.channel.send("✅ Purchase successful!");

    } catch (err) {
        console.error("MARKET BUY CRASH:", err);
        return message.channel.send("❌ Buy failed.");
    }
}

        // ================= AUCTION =================
if (cmd === "/auction" && args[0] === "sell") {
    try {
        const price = Number(args[args.length - 2]);
        const duration = Number(args[args.length - 1]);
        const nameQuery = args.slice(1, -2).join(" ").toLowerCase();

        const matches = user.club.filter(c => {
            const card = cardMap.get(c.cardId);
            return card && card.name.toLowerCase().includes(nameQuery);
        });

        if (!matches.length) return message.channel.send("❌ Not owned");

        let item;

        if (matches.length > 1) {
            pendingAuctionSell[message.author.id] = {
                matches,
                price,
                duration
            };

            let text = "⚠️ Multiple versions found:\n\n";
            matches.forEach((m, i) => {
                const card = cardMap.get(m.cardId);
                text += `${i + 1}. ${card.name}\nID: ${m.instanceId}\n\n`;
            });

            text += "👉 Use: /auctionselect <number>";
            return message.channel.send(text);
        }

        item = matches[0];

        // REMOVE FROM CLUB (LOCK INTO AUCTION)
        user.club = user.club.filter(c => c.instanceId !== item.instanceId);

        const auction = createAuction({
            sellerId: message.author.id,
            item,
            price,
            duration
        });

        saveData?.();

        return message.channel.send(`🏆 Auction started (ID: ${auction.id})`);

    } catch (err) {
        console.error("AUCTION SELL CRASH:", err);
    }
}

if (cmd === "/bid") {
    try {
        user.money = Number(user.money) || 0;
        auctions = auctions || [];

        const id = Number(args[0]);
        const bid = Number(args[1]);

        if (!Number.isFinite(id) || !Number.isFinite(bid)) {
            return message.channel.send("❌ Use: /bid <id> <amount>");
        }

        const auction = auctions.find(a => a.id === id && a.active);

        if (!auction) {
            return message.channel.send("❌ Auction not found");
        }

        if (Date.now() >= auction.endTime) {
            auction.active = false;
            return message.channel.send("❌ Auction already ended");
        }

        if (bid <= auction.currentBid) {
            return message.channel.send(
                `❌ Bid must be higher than $${auction.currentBid}`
            );
        }

        if (user.money < bid) {
            return message.channel.send("❌ Not enough money");
        }

        // 💥 REFUND OLD BIDDER SAFELY
        if (auction.highestBidderId) {
            const oldUser = getUser(auction.highestBidderId);

            if (oldUser) {
                oldUser.money = Number(oldUser.money) || 0;
                oldUser.money += auction.currentBid;
            }
        }

        // 💰 ESCROW NEW BIDDER MONEY
        user.money -= bid;

        auction.currentBid = bid;
        auction.highestBidderId = message.author.id;

        saveData?.();

        return message.channel.send(`📈 Bid placed: $${bid}`);

    } catch (err) {
        console.error("BID CRASH:", err);
        return message.channel.send("❌ Bid failed.");
    }
}

        if (cmd === "/auctionselect") {
    const data = pendingAuctionSell[message.author.id];
    if (!data) return message.channel.send("❌ No pending auction");

    const index = Number(args[0]) - 1;
    const selected = data.matches[index];

    if (!selected) return message.channel.send("❌ Invalid selection");

    user.club = user.club.filter(c => c.instanceId !== selected.instanceId);

    const auction = createAuction({
        sellerId: message.author.id,
        item: selected,
        price: data.price,
        duration: data.duration
    });

    delete pendingAuctionSell[message.author.id];

    saveData?.();

    return message.channel.send(`🏆 Auction started (ID: ${auction.id})`);
}

if (cmd === "/auction" && args[0] === "view") {
    const now = Date.now();

    const active = auctions.filter(a =>
        a.active && a.endTime > now
    );

    if (!active.length) {
        return message.channel.send("❌ No active auctions.");
    }

    let text = "🏆 ACTIVE AUCTIONS\n\n";

    for (const a of active) {
        const card = cardMap.get(a.item.cardId);
        if (!card) continue;

        text +=
`ID: ${a.id}
🎴 ${card.name}
💰 Current Bid: $${a.currentBid}
⏳ ${Math.floor((a.endTime - now) / 1000)}s

`;
    }

    return message.channel.send(text);
}

        // ================= GUILD =================
if (cmd === "/guild" && args[0] === "create") {

    if (user.guild && guilds[user.guild]) {
        return message.channel.send("❌ You are already in a guild.");
    }

    const name = args.slice(1).join(" ").trim();

    // 🧠 VALIDATION FIXES
    if (!name) {
        return message.channel.send("❌ Provide guild name.");
    }

    if (name.length < 3) {
        return message.channel.send("❌ Guild name too short (min 3 chars).");
    }

    if (name.length > 25) {
        return message.channel.send("❌ Guild name too long (max 25 chars).");
    }

    const normalized = name.toLowerCase().replace(/\s+/g, " ").trim();

    // 🚫 duplicate check
    const exists = Object.values(guilds).some(g =>
        (g.name || "").toLowerCase().replace(/\s+/g, " ").trim() === normalized
    );

    if (exists) {
        return message.channel.send("❌ A guild with this name already exists.");
    }

    const guildId = `${normalized.replace(/\s+/g, "_")}_${Date.now()}`;

    guilds[guildId] = {
        id: guildId,
        name: name,
        owner: message.author.id,
        balance: 0,
        level: 1,
        upgrades: 0,
        members: [message.author.id],
        perks: {
            moneyBoost: 0,
            packLuck: 0
        }
    };

    user.guild = guildId;
    user.guildRole = "leader";

    saveData?.();

    return message.channel.send(`🏰 Guild "${name}" created`);
}

if (cmd === "/guild" && args[0] === "join") {

    const query = args.slice(1).join(" ").trim().toLowerCase();

    if (!query) {
        return message.channel.send("❌ Provide guild name.");
    }

    if (user.guild && guilds[user.guild]) {
        return message.channel.send("❌ You are already in a guild.");
    }

    const guild = Object.values(guilds).find(g => {
        const name = (g?.name || "")
            .toLowerCase()
            .replace(/\s+/g, " ")
            .trim();

        return (
            name === query ||
            name.includes(query) // 🔥 allows partial matching
        );
    });

    if (!guild) {
        return message.channel.send("❌ Guild not found.");
    }

    guild.members = guild.members || [];

    // 🧠 HARD SAFETY: prevent duplicate membership
    if (guild.members.includes(message.author.id)) {
        return message.channel.send("❌ Already in this guild.");
    }

    // 🧠 extra safety: ensure user isn't stuck in old guild
    if (user.guild && guilds[user.guild]) {
        const old = guilds[user.guild];
        old.members = (old.members || []).filter(id => id !== message.author.id);
    }

    guild.members.push(message.author.id);

    user.guild = guild.id;
    user.guildRole = "member";

    saveData?.();

    return message.channel.send(`✅ Joined "${guild.name}"`);
}

if (cmd === "/guild" && args[0] === "leave") {
    try {
        const guildId = user.guild;
        const guild = guilds?.[guildId];

        // not in guild
        if (!guildId || !guild) {
            user.guild = null;
            user.guildRole = null;
            saveData?.();
            return message.channel.send("❌ You are not in a guild.");
        }

        // ensure members array exists
        guild.members = Array.isArray(guild.members) ? guild.members : [];

        // remove user
        guild.members = guild.members.filter(id => id !== message.author.id);

        // cleanup empty guild
        if (guild.members.length === 0) {
            delete guilds[guildId];
        }

        // reset user data
        user.guild = null;
        user.guildRole = null;

        saveData?.();

        return message.channel.send("🚪 Left guild");

    } catch (err) {
        console.error("GUILD LEAVE ERROR:", err);
        return message.channel.send("❌ Failed to leave guild.");
    }
}

if (cmd === "/guild" && args[0] === "perks") {
    try {
        const guildId = user.guild;
        const guild = guilds?.[guildId];

        if (!guildId || !guild) {
            return message.channel.send("❌ You are not in a guild.");
        }
        console.log("DEPOSIT BANK:", guild.bank);

        guild.perks = guild.perks || {
            moneyBoost: 0,
            packLuck: 0
        };

        const moneyBoost = Number(guild.perks.moneyBoost) || 0;
        const packLuck = Number(guild.perks.packLuck) || 0;

        return message.channel.send(
            `⚡ Guild Perks (${guild.name}):\n` +
            `💰 Money Boost: ${moneyBoost}%\n` +
            `🎁 Pack Luck: ${packLuck}%`
        );

    } catch (err) {
        console.error("GUILD PERKS ERROR:", err);
        return message.channel.send("❌ Failed to load guild perks.");
    }
}


if (cmd === "/guild" && args[0] === "deposit") {
    try {
        const guildId = user.guild;
        const guild = guilds?.[guildId];

        if (!guildId || !guild) {
            return message.channel.send("❌ You are not in a guild.");
        }

        const amount = Number(args[1]);

        if (!Number.isFinite(amount) || amount <= 0) {
            return message.channel.send("❌ Invalid amount.");
        }

        user.money = Number(user.money) || 0;

        if (user.money < amount) {
            return message.channel.send("❌ Not enough money.");
        }

        // 🔥 FORCE SINGLE SOURCE OF TRUTH
        guilds[guildId].bank = Number(guilds[guildId].bank ?? 0);

        user.money -= amount;
        guilds[guildId].bank += amount;

        console.log("DEPOSIT DEBUG BANK:", guilds[guildId].bank);

        saveData?.();

        return message.channel.send(
            `💰 Deposited $${amount} to guild bank.`
        );

    } catch (err) {
        console.error("GUILD DEPOSIT ERROR:", err);
        return message.channel.send("❌ Deposit failed.");
    }
}

if (cmd === "/guild" && args[0] === "view") {
    try {
        const guildId = user.guild;
        const guild = guilds?.[guildId];

        if (!guildId || !guild) {
            return message.channel.send("❌ You are not in a guild.");
        }

        guild.balance = Number(guild.balance) || 0;
        guild.members = Array.isArray(guild.members) ? guild.members : [];

        guild.perks = guild.perks || {
            moneyBoost: 0,
            packLuck: 0
        };

        const text =
`🏰 GUILD INFO

🏷 Name: ${guild.name}
💰 Bank: $${guild.balance}

👥 Members: ${guild.members.length}

⚡ Perks:
- Money Boost: ${Number(guild.perks.moneyBoost) || 0}%
- Pack Luck: ${Number(guild.perks.packLuck) || 0}%

👑 Your Role: ${user.guildRole || "member"}
`

        return message.channel.send(text);

    } catch (err) {
        console.error("GUILD VIEW ERROR:", err);
        return message.channel.send("❌ Failed to load guild.");
    }
}

if (cmd === "/guild" && args[0] === "upgrade") {
    try {
        const guildId = user.guild;
        const g = guilds?.[guildId];

        if (!guildId || !g) {
            return message.channel.send("❌ You are not in a guild.");
        }

        if ((user.guildRole || "").toLowerCase() !== "leader") {
            return message.channel.send("❌ Only the guild leader can upgrade.");
        }

        // 🔥 HARD SAFETY (prevents NaN forever)
        g.bank = Number(g.bank);
        if (!Number.isFinite(g.bank)) g.bank = 0;

        g.upgrades ??= { packLuck: 0, moneyBoost: 0 };

        g.upgrades.packLuck = Number(g.upgrades.packLuck);
        g.upgrades.moneyBoost = Number(g.upgrades.moneyBoost);

        if (!Number.isFinite(g.upgrades.packLuck)) g.upgrades.packLuck = 0;
        if (!Number.isFinite(g.upgrades.moneyBoost)) g.upgrades.moneyBoost = 0;

        const level = g.upgrades.packLuck + g.upgrades.moneyBoost;

        const baseCost = 10000;
        const cost = Math.floor(baseCost * Math.pow(1.5, level));

        if (!Number.isFinite(cost)) {
            return message.channel.send("❌ Internal error: invalid upgrade cost.");
        }

        if (g.bank < cost) {
            return message.channel.send(
                `❌ Not enough guild funds.\n💰 You need $${cost - g.bank} more.\n🏦 Cost: $${cost}`
            );
        }

        g.upgrades.packLuck += 1;
        g.upgrades.moneyBoost += 1;

        g.bank -= cost;

        saveData?.();

        return message.channel.send(
            `✅ Guild upgraded!\n` +
            `⚡ Pack Luck: ${g.upgrades.packLuck}%\n` +
            `💰 Money Boost: ${g.upgrades.moneyBoost}%\n` +
            `🏦 Cost paid: $${cost}`
        );

    } catch (err) {
        console.error("GUILD UPGRADE ERROR:", err);
        return message.channel.send("❌ Upgrade failed.");
    }
}
// ================= SAVE =================
      saveData?.();

} catch (err) {
        console.error("MESSAGECREATE CRASH:", err);
    }
});

setInterval(() => {
    for (const guildId in guilds) {
        const guild = guilds[guildId];
        if (!guild) continue;

        guild.bank = Number(guild.bank) || 0;

        const interestRate = Number(guild.upgrades?.bankInterest) || 0;

        if (interestRate <= 0) continue;

        const gain = Math.floor(guild.bank * (interestRate / 1000));

        guild.bank += gain;
    }
}, 3600000);


// ================= START BOT =================

client.once("ready", () => {
    console.log("🤖 BOT ONLINE:", client.user.tag);
});

// IMPORTANT: this actually connects your bot to Discord
client.login(process.env.TOKEN);