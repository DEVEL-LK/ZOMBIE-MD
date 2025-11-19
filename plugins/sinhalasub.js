/*
 * SinhalaSub Bot – FULL PREMIUM COMMAND
 * Search 20 Results → Next Page → Full OMDb Details → Quality Select → Download
 */

const l = console.log;
const config = require('../config'); 
const { cmd } = require('../command');
const axios = require('axios');
const NodeCache = require('node-cache');

const API_KEY = 'c56182a993f60b4f49cf97ab09886d17';
const SEARCH_API = 'https://sadaslk-apis.vercel.app/api/v1/movie/sinhalasub/search?';
const MOVIE_DL_API = 'https://sadaslk-apis.vercel.app/api/v1/movie/sinhalasub/infodl?';
const TV_DL_API   = 'https://sadaslk-apis.vercel.app/api/v1/movie/sinhalasub/tv/dl?';

const cache = new NodeCache({ stdTTL: 60 });

function fixPixelDrain(url) {
    if (!url.includes("/u/")) return url;
    const id = url.split("/u/")[1];
    return `https://pixeldrain.com/api/file/${id}?download`;
}

// Auto-clean title for OMDb search
function cleanTitle(title) {
    let t = title.replace(/Sinhala Subtitles|සිංහල උපසිරසි/gi, '');
    t = t.replace(/\([0-9]{4}\)/g, match => match); // Keep year
    t = t.replace(/S[0-9]{1,2}E[0-9]{1,2}/gi, ''); // Remove episode numbers
    t = t.replace(/[^a-zA-Z0-9\s]/g, ''); // Remove symbols
    t = t.replace(/\s+/g, ' ').trim();
    return t;
}

cmd({
    pattern: 'sinhalasub',
    react: '🎬',
    desc: 'Download Sinhala Sub Movies with FULL DETAILS',
    category: 'download',
    filename: __filename
}, async (bot, msg, ctx, { from, q }) => {

    if (!q) {
        await bot.sendMessage(from, {
            text: "Usage:\n.sinhalasub Avatar\n.sinhalasub Breaking Bad"
        }, { quoted: msg });
        return;
    }

    try {
        const pageSize = 20;
        const key = `search_${q.toLowerCase()}`;
        let data = cache.get(key) || { results: [], page: 1 };

        // Fetch if cache empty or new search
        if (!data.results.length) {
            const url = `${SEARCH_API}q=${encodeURIComponent(q)}&apiKey=${API_KEY}`;
            const api = await axios.get(url);
            const list = api.data?.data || [];
            if (!list.length) throw new Error("❌ No results found.");

            data.results = list.map((it, i) => ({
                n: i + 1,
                title: it.Title || it.title,
                link: it.Link || it.link,
                image: it.Img || it.image
            }));
            cache.set(key, data);
        }

        const currentPage = data.page;
        const start = (currentPage - 1) * pageSize;
        const end = start + pageSize;
        const pageResults = data.results.slice(start, end);

        let txt = `*🎬 SEARCH RESULTS (Page ${currentPage})*\n\n`;
        pageResults.forEach(r => txt += `${r.n}. ${r.title}\n`);
        if (data.results.length > end) txt += `\nReply 21 → Next Page`;
        txt += "\n\nReply with Number";

        const searchMsg = await bot.sendMessage(from, {
            image: { url: pageResults[0].image },
            caption: txt
        }, { quoted: msg });

        const state = new Map();

        const handler = async ({ messages }) => {
            const m = messages?.[0];
            const text = m?.message?.extendedTextMessage?.text?.trim();
            const quotedId = m?.message?.extendedTextMessage?.contextInfo?.stanzaId;
            if (!text || !quotedId) return;

            // Next Page
            if (text === "21" && quotedId === searchMsg.key.id) {
                data.page += 1;
                cache.set(key, data);
                await bot.sendMessage(from, { text: `📄 Loading Page ${data.page}...` }, { quoted: m });
                bot.ev.off("messages.upsert", handler);
                cmd({ pattern: 'sinhalasub', react: '🎬', desc: '', category: '', filename: __filename }, async (bot2, msg2, ctx2, { from: from2, q: q2 }) => {}); // Re-run command
                return;
            }

            // ----- SELECT MOVIE -----
            if (quotedId === searchMsg.key.id) {
                const pick = data.results.find(x => x.n === parseInt(text));
                if (!pick) {
                    await bot.sendMessage(from, { text: "❌ Invalid number." }, { quoted: m });
                    return;
                }

                const isTV = pick.link.includes("/episodes/");
                const infoURL = (isTV ? TV_DL_API : MOVIE_DL_API) + 
                                `q=${encodeURIComponent(pick.link)}&apiKey=${API_KEY}`;

                let info;
                try {
                    info = await axios.get(infoURL);
                    info = info.data;
                } catch {
                    await bot.sendMessage(from, { text: "❌ Failed to load movie info." }, { quoted: m });
                    return;
                }

                const cleanSearch = cleanTitle(pick.title);
                let omdbData = {};
                try {
                    const omdbResp = await axios.get(`https://omdbapi.b-cdn.net/?t=${encodeURIComponent(cleanSearch)}`);
                    omdbData = omdbResp.data || {};
                } catch {}

                const full = {
                    title: omdbData.Title || pick.title,
                    imdb: omdbData.imdbRating || "N/A",
                    year: omdbData.Year || "N/A",
                    genre: omdbData.Genre || "N/A",
                    plot: omdbData.Plot || "N/A",
                    actors: omdbData.Actors || "N/A",
                    director: omdbData.Director || "N/A",
                    country: omdbData.Country || "N/A",
                    language: omdbData.Language || "N/A",
                    image: omdbData.Poster || pick.image
                };

                let details = `*🎬 ${full.title}*\n\n`;
                details += full.imdb !== "N/A" ? `⭐ IMDb: ${full.imdb}\n` : '';
                details += full.year !== "N/A" ? `📅 Year: ${full.year}\n` : '';
                details += full.genre !== "N/A" ? `🎭 Genre: ${full.genre}\n` : '';
                details += full.actors !== "N/A" ? `👩‍💼 Actors: ${full.actors}\n` : '';
                details += full.director !== "N/A" ? `🎬 Director: ${full.director}\n` : '';
                details += full.country !== "N/A" ? `🌍 Country: ${full.country}\n` : '';
                details += full.language !== "N/A" ? `🗣️ Language: ${full.language}\n` : '';
                details += full.plot !== "N/A" ? `\n📝 *Plot:* ${full.plot}\n` : '';

                const infoMsg = await bot.sendMessage(from, {
                    image: { url: full.image },
                    caption: details
                }, { quoted: m });

                // Prepare quality links
                let links = [];
                if (isTV) {
                    links = info.data?.episodes || [];
                } else {
                    links = info.data?.downloadLinks || [];
                }

                const qList = links.map((x, i) => ({
                    n: i + 1,
                    quality: x.quality || x.q,
                    size: x.size || "Unknown",
                    link: x.finalDownloadUrl || x.link,
                    episode: x.episode
                }));

                let qTxt = "*📥 Choose Quality*\n\n";
                for (const q of qList) qTxt += `${q.n}. ${q.quality} • ${q.size}\n`;

                const qMsg = await bot.sendMessage(from, {
                    caption: qTxt,
                    image: { url: full.image }
                });

                state.set(qMsg.key.id, { qList, pick, isTV });
                return;
            }

            // ----- QUALITY SELECT -----
            if (state.has(quotedId)) {
                const { qList, pick } = state.get(quotedId);
                const chosen = qList.find(x => x.n === parseInt(text));
                if (!chosen) {
                    await bot.sendMessage(from, { text: "❌ Wrong Quality." }, { quoted: m });
                    return;
                }

                const buffer = await axios.get(
                    fixPixelDrain(chosen.link),
                    { responseType: "arraybuffer" }
                ).then(r => r.data);

                await bot.sendMessage(from, {
                    document: buffer,
                    mimetype: "video/mp4",
                    fileName: `${pick.title} - ${chosen.quality}.mp4`,
                    caption: `🎬 ${pick.title}\n📥 ${chosen.quality}`
                }, { quoted: m });

                await bot.sendMessage(from, { react: { text: "✅", key: m.key } });
            }
        };

        bot.ev.on("messages.upsert", handler);

    } catch (e) {
        await bot.sendMessage(from, { text: "❌ Error: " + e.message }, { quoted: msg });
    }
});
