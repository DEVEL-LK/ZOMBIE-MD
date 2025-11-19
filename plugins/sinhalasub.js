/*
 * Advanced SinhalaSub Bot Command – Modified Version
 * Number reply → First show Movie Details → Then Quality Selector
 */

const l = console.log;
const config = require('../config'); 
const { cmd } = require('../command');
const axios = require('axios');
const NodeCache = require('node-cache');

const API_KEY = 'c56182a993f60b4f49cf97ab09886d17';
const SEARCH_API = 'https://sadaslk-apis.vercel.app/api/v1/movie/sinhalasub/search?';
const MOVIE_DL_API = 'https://sadaslk-apis.vercel.app/api/v1/movie/sinhalasub/infodl?';
const TV_DL_API = 'https://sadaslk-apis.vercel.app/api/v1/movie/sinhalasub/tv/dl?';

const searchCache = new NodeCache({ stdTTL: 60 });

// PixelDrain Direct Download Fix
function fixPixelDrain(url) {
    if (!url.includes("/u/")) return url;
    const id = url.split("/u/")[1];
    return `https://pixeldrain.com/api/file/${id}?download`;
}

cmd({
    pattern: 'sinhalasub',
    react: '🎬',
    desc: 'Search Movies/TV Series',
    category: 'download',
    filename: __filename
}, async (bot, message, context, { from, q: searchQuery }) => {

    if (!searchQuery) {
        await bot.sendMessage(from, {
            text: '*💡 Type Your Movie Name*\n\n📌 Example:\n.sinhalasub Breaking Bad'
        }, { quoted: message });
        return;
    }

    try {
        const cacheKey = 'film_' + searchQuery.toLowerCase();
        let apiData = searchCache.get(cacheKey);

        if (!apiData) {
            const url = `${SEARCH_API}q=${encodeURIComponent(searchQuery)}&apiKey=${API_KEY}`;
            const response = await axios.get(url, { timeout: 10000 });

            const list = response?.data?.data || [];
            if (!list.length) throw new Error("❌ No results found.");

            apiData = { status: true, data: list };
            searchCache.set(cacheKey, apiData);
        }

        const results = apiData.data.map((item, i) => ({
            n: i + 1,
            title: item.Title || item.title,
            imdb: item.Rating || item.imdb || "N/A",
            year: item.Year || item.year || "N/A",
            plot: item.Plot || item.plot || "N/A",
            genre: item.Genre || item.genre || "N/A",
            link: item.Link || item.link,
            image: item.Img || item.image || 'https://i.imgur.com/SL4nVxv.png'
        }));

        // --- Search List (ONLY Numbers + Titles) ---
        let replyText = "*🎬 SEARCH RESULTS*\n\n";
        for (const r of results) replyText += `${r.n}. ${r.title}\n`;
        replyText += "\n🔢 Reply with number";

        const sentMessage = await bot.sendMessage(from, {
            image: { url: results[0].image },
            caption: replyText
        }, { quoted: message });

        const state = new Map();

        const handler = async ({ messages }) => {
            const msg = messages?.[0];
            const t = msg?.message?.extendedTextMessage?.text?.trim();
            const quotedId = msg?.message?.extendedTextMessage?.contextInfo?.stanzaId;

            if (!t || !quotedId) return;

            if (quotedId === sentMessage.key.id) {

                const selected = results.find(x => x.n === parseInt(t));
                if (!selected) {
                    await bot.sendMessage(from, { text: "❌ Invalid number." }, { quoted: msg });
                    return;
                }

                // FIRST → SEND FULL MOVIE INFO
                const movieInfo = `*🎬 ${selected.title}*\n\n` +
                    `⭐ IMDb: ${selected.imdb}\n` +
                    `📅 Year: ${selected.year}\n` +
                    `🎭 Genre: ${selected.genre}\n\n` +
                    `📝 *Plot:* ${selected.plot}\n`;

                await bot.sendMessage(from, {
                    image: { url: selected.image },
                    caption: movieInfo
                }, { quoted: msg });

                // THEN → FETCH DOWNLOAD LINKS
                const isTV = selected.link.includes('/episodes/');
                const url = (isTV ? TV_DL_API : MOVIE_DL_API) + 
                    `q=${encodeURIComponent(selected.link)}&apiKey=${API_KEY}`;

                let dl;
                try {
                    const r = await axios.get(url);
                    dl = r.data;
                } catch {
                    await bot.sendMessage(from, { text: "❌ Failed to load download links." });
                    return;
                }
                if (!dl.status) return;

                let links = [];
                let thumb = selected.image;

                if (isTV) {
                    links = dl.data || [];
                } else {
                    links = dl.data.downloadLinks || [];
                    thumb = dl.data.images?.[0] || thumb;
                }

                const qualityList = links.map((x, i) => ({
                    n: i + 1,
                    quality: x.quality,
                    size: x.size,
                    link: x.finalDownloadUrl || x.link,
                    episode: x.episode
                }));

                let qText = `*📥 Choose Quality*\n\n`;
                for (const q of qualityList) {
                    qText += `${q.n}. ${q.quality} • ${q.size}\n`;
                }

                const qMsg = await bot.sendMessage(from, {
                    image: { url: thumb },
                    caption: qText
                }, { quoted: msg });

                state.set(qMsg.key.id, { selected, qualityList, isTV });
                return;
            }

            // QUALITY SELECTOR
            if (state.has(quotedId)) {
                const { selected, qualityList, isTV } = state.get(quotedId);
                const pick = qualityList.find(x => x.n === parseInt(t));
                if (!pick) {
                    await bot.sendMessage(from, { text: "❌ Wrong Quality." }, { quoted: msg });
                    return;
                }

                const buffer = await axios.get(
                    fixPixelDrain(pick.link),
                    { responseType: "arraybuffer" }
                ).then(r => r.data);

                await bot.sendMessage(from, {
                    document: buffer,
                    mimetype: 'video/mp4',
                    fileName: `🎬 ${selected.title} • ${pick.quality}.mp4`,
                    caption: `🎬 ${selected.title}\n📥 ${pick.quality}`
                }, { quoted: msg });

                await bot.sendMessage(from, { react: { text: "✅", key: msg.key } });
            }
        };

        bot.ev.on("messages.upsert", handler);

    } catch (err) {
        await bot.sendMessage(from, { text: "❌ Error: " + err.message }, { quoted: message });
    }
});
