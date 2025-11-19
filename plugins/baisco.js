/*
 * SinhalaSub Bot – FULL DETAIL + ERROR FIXED + TV/Movie Support
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

cmd({
    pattern: 'sinhalasub',
    react: '🎬',
    desc: 'Download Sinhala Sub Movies',
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
        const key = "search_" + q.toLowerCase();
        let data = cache.get(key);

        if (!data) {
            const url = `${SEARCH_API}q=${encodeURIComponent(q)}&apiKey=${API_KEY}`;
            const api = await axios.get(url);
            const list = api.data?.data || [];

            if (!list.length) throw new Error("❌ No results found.");

            data = list.map((it, i) => ({
                n: i + 1,
                title: it.Title || it.title,
                link: it.Link || it.link,
                image: it.Img || it.image
            }));

            cache.set(key, data);
        }

        let txt = "*🎬 SEARCH RESULTS*\n\n";
        for (const r of data) txt += `${r.n}. ${r.title}\n`;
        txt += "\nReply with Number";

        const searchMsg = await bot.sendMessage(from, {
            image: { url: data[0].image },
            caption: txt
        }, { quoted: msg });

        const state = new Map();

        const handler = async ({ messages }) => {
            const m = messages?.[0];
            const text = m?.message?.extendedTextMessage?.text?.trim();
            const quotedId = m?.message?.extendedTextMessage?.contextInfo?.stanzaId;
            if (!text || !quotedId) return;

            // ----- SELECT MOVIE (Updated for Full Details) -----
            if (quotedId === searchMsg.key.id) {
                const pick = data.find(x => x.n === parseInt(text));
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
                } catch (e) {
                    l(e)
                    await bot.sendMessage(from, { text: "❌ Failed to load movie info." }, { quoted: m });
                    return;
                }

                const apiData = info.data || {};

                // Extract all relevant details from API
                const full = {
                    title: apiData.title || pick.title,
                    imdb: apiData.imdb || apiData.rating || "N/A",
                    year: apiData.year || apiData.releaseYear || "N/A",
                    country: apiData.country || "India", // Defaulting to India as in the image
                    duration: apiData.duration || "N/A",
                    genre: apiData.genre || apiData.genres || "N/A",
                    director: apiData.director || "N/A",
                    cast: apiData.cast ? apiData.cast.join(', ') : "N/A",
                    plot: apiData.plot || apiData.description || apiData.story || "N/A",
                    image: apiData.image || pick.image,
                    downloadLinks: isTV ? apiData.episodes : apiData.downloadLinks
                };

                // Format the main detail message like in the image
                let details = `*🍀 TITLE ➛ ${full.title}*\n\n`;

                details += `📅 **RELEASE Date** ➛ ${full.year}\n`;
                details += `🌍 **COUNTRY** ➛ _${full.country}_\n`;
                if (full.duration !== "N/A") details += `⏱️ **DURATION** ➛ _${full.duration}_\n`;
                if (full.genre !== "N/A") details += `🎦 **GENRES** ➛ _${full.genre}_\n`;
                if (full.director !== "N/A") details += `🤵 **DIRECTOR** ➛ ${full.director}\n`;
                if (full.cast !== "N/A") details += `👥 **CAST** ➛ ${full.cast}\n`;

                details += "\n--- *Download Details* ---\n";

                const qList = (full.downloadLinks || []).map((x, i) => ({
                    n: i + 1,
                    quality: x.quality || x.q || (isTV ? `E${x.episode}` : "Quality"),
                    size: x.size || "Unknown",
                    link: x.finalDownloadUrl || x.link,
                    episode: x.episode
                }));

                if (qList.length > 0) {
                    for (const q of qList) details += `${q.n} ❱❱ **${q.quality}** ➛ _${q.size}_\n`;
                    details += "\n*Reply below number to Download*";
                } else {
                    details += "❌ No download links found.";
                }

                const detailMsg = await bot.sendMessage(from, {
                    image: { url: full.image },
                    caption: details
                }, { quoted: m });

                if (qList.length > 0) {
                     // Save state for quality selection
                    state.set(detailMsg.key.id, { qList, pick, isTV });
                }
                return;
            }

            // ----- QUALITY SELECT (Now replies to the Detail Msg) -----
            if (state.has(quotedId)) {
                const { qList, pick } = state.get(quotedId);

                const chosen = qList.find(x => x.n === parseInt(text));
                if (!chosen) {
                    await bot.sendMessage(from, { text: "❌ Wrong Quality." }, { quoted: m });
                    return;
                }
                
                // Remove the state entry after selection to prevent multiple downloads
                state.delete(quotedId);

                await bot.sendMessage(from, { react: { text: "⏳", key: m.key } });

                try {
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
                } catch (error) {
                    await bot.sendMessage(from, { text: "❌ Failed to download file. Please try another quality or check the link." }, { quoted: m });
                    await bot.sendMessage(from, { react: { text: "❌", key: m.key } });
                }
            }
        };

        bot.ev.on("messages.upsert", handler);

    } catch (e) {
        await bot.sendMessage(from, { text: "❌ Error: " + e.message }, { quoted: msg });
    }
});
