/*
 * Cinesubz Bot Command – FULL DETAIL + 100% REPLY BASED + ERROR FIXED
 */

const l = console.log;
const config = require('../config'); 
const { cmd } = require('../command');
const axios = require('axios');
const NodeCache = require('node-cache');

// --- Cinesubz API Configuration ---
const API_BASE = 'https://foreign-marna-sithaunarathnapromax-9a005c2e.koyeb.app/api/cinesubz';
const API_KEY = '25f974dba76310042bcd3c9488eec9093816ef32eb36d34c1b6b875ac9215932';

const SEARCH_API = `${API_BASE}/search?`;
const MOVIE_DETAIL_API = `${API_BASE}/movie-details?`;
const TVSHOW_DETAIL_API = `${API_BASE}/tvshow-details?`;
const EPISODE_DETAIL_API = `${API_BASE}/episode-details?`;
const DOWNLOAD_API = `${API_BASE}/downloadurl?`;

const cache = new NodeCache({ stdTTL: 600 }); // Cache for 10 minutes

// Helper function to extract type (movie or tvshow) - **ERROR FIX INCLUDED**
function getMediaType(url) {
    // URL එකක් string එකක් බවට සහතික කිරීම
    if (typeof url !== 'string' || !url) return 'movie'; 
    
    if (url.includes("/episodes/")) return 'episode';
    if (url.includes("/tvshows/")) return 'tvshow';
    return 'movie';
}

cmd({
    pattern: 'cinesubz',
    react: '🍿',
    desc: 'Download Sinhala Sub Movies/TV Shows from Cinesubz',
    category: 'download',
    filename: __filename
}, async (bot, msg, ctx, { from, q }) => {

    if (!q) {
        await bot.sendMessage(from, {
            text: "Usage:\n.cinesubz Avatar\n.cinesubz Peaky Blinders"
        }, { quoted: msg });
        return;
    }

    try {
        const key = "cinesubz_search_" + q.toLowerCase();
        let data = cache.get(key);

        if (!data) {
            const url = `${SEARCH_API}q=${encodeURIComponent(q)}&apiKey=${API_KEY}`;
            const api = await axios.get(url);
            const list = api.data?.data || [];

            if (!list.length) throw new Error("❌ No results found on Cinesubz.");

            data = list.map((it, i) => ({
                n: i + 1,
                title: it.Title,
                link: it.Link,
                image: it.Image || it.image,
                type: getMediaType(it.Link) // Link is checked for safety here
            }));

            cache.set(key, data);
        }

        let txt = "*🍿 CINESUBZ SEARCH RESULTS*\n\n";
        for (const r of data) txt += `${r.n}. [${r.type.toUpperCase()}] ${r.title}\n`;
        txt += "\nReply with the *Number* to view details.";

        const searchMsg = await bot.sendMessage(from, {
            image: { url: data[0].image },
            caption: txt
        }, { quoted: msg });

        const state = new Map();
        
        // Setup handler to listen for all subsequent replies
        const handler = async ({ messages }) => {
            const m = messages?.[0];
            const text = m?.message?.extendedTextMessage?.text?.trim();
            const quotedId = m?.message?.extendedTextMessage?.contextInfo?.stanzaId;
            if (!text || !quotedId) return;

            // --- 1. SEARCH RESULT SELECTION (Replied to searchMsg) ---
            if (quotedId === searchMsg.key.id) {
                const pick = data.find(x => x.n === parseInt(text));
                if (!pick) {
                    await bot.sendMessage(from, { text: "❌ Invalid number. Please reply with a valid serial number." }, { quoted: m });
                    return;
                }

                const mediaType = getMediaType(pick.link);
                let infoURL = '';
                
                if (mediaType === 'tvshow') {
                    infoURL = TVSHOW_DETAIL_API;
                } else if (mediaType === 'episode') {
                    infoURL = EPISODE_DETAIL_API;
                } else { // movie
                    infoURL = MOVIE_DETAIL_API;
                }

                infoURL += `url=${encodeURIComponent(pick.link)}&apiKey=${API_KEY}`;
                
                let info;
                try {
                    info = await axios.get(infoURL);
                } catch (e) {
                    l(e);
                    await bot.sendMessage(from, { text: `❌ Failed to load ${mediaType} info.` }, { quoted: m });
                    return;
                }

                const apiData = info.data?.data || {};

                // --- Format and Send Details Message ---
                let details = `*🍀 TITLE ➛ ${apiData.title || pick.title}*\n\n`;

                if (apiData.year) details += `📅 **RELEASE Date** ➛ ${apiData.year}\n`;
                if (apiData.country) details += `🌍 **COUNTRY** ➛ _${apiData.country}_\n`;
                if (apiData.duration) details += `⏱️ **DURATION** ➛ _${apiData.duration}_\n`;
                if (apiData.genre && apiData.genre.length) details += `🎦 **GENRES** ➛ _${apiData.genre.join(', ')}_\n`;
                if (apiData.director && apiData.director.length) details += `🤵 **DIRECTOR** ➛ ${apiData.director.join(', ')}\n`;
                if (apiData.cast && apiData.cast.length) details += `👥 **CAST** ➛ ${apiData.cast.join(', ')}\n`;
                if (apiData.plot) details += `\n📝 *Plot:* ${apiData.plot}\n`;
                
                // --- Prepare Quality/Episode List ---
                let qList = [];
                let qTxtTitle = '';

                if (mediaType === 'tvshow') {
                    qTxtTitle = '*📥 Choose Season/Episode (Reply below number)*';
                    qList = (apiData.episodes || []).map((x, i) => ({
                        n: i + 1,
                        title: x.title,
                        link: x.link,
                        is_episode: true
                    }));
                } else if (mediaType === 'episode') {
                    qTxtTitle = '*📥 Choose Download Quality (Reply below number)*';
                    qList = (apiData.download_links || []).map((x, i) => ({
                        n: i + 1,
                        quality: x.quality,
                        size: x.size,
                        link: x.link,
                        is_download: true
                    }));
                } else { // movie
                    qTxtTitle = '*📥 Choose Download Quality (Reply below number)*';
                    qList = (apiData.download_links || []).map((x, i) => ({
                        n: i + 1,
                        quality: x.quality,
                        size: x.size,
                        link: x.link,
                        is_download: true
                    }));
                }
                
                // Add note about the next step
                details += "\n--- *Next, choose the quality/episode in the message below.* ---";

                // Send Detail Message
                const detailMsg = await bot.sendMessage(from, {
                    image: { url: apiData.image || pick.image },
                    caption: details
                }, { quoted: m });


                if (qList.length > 0) {
                    // Send Quality/Episode Selection Message
                    let qTxt = `${qTxtTitle}\n\n`;
                    for (const q of qList) {
                        if (q.is_episode) {
                             qTxt += `${q.n} ❱❱ **${q.title}**\n`;
                        } else {
                             qTxt += `${q.n} ❱❱ **${q.quality}** ➛ _${q.size}_\n`;
                        }
                    }
                    qTxt += "\n⭐❰ASITHA MOVIE❱⭐";
                    
                    const qMsg = await bot.sendMessage(from, {
                        caption: qTxt,
                    }, { quoted: m }); 

                    // Save state using the Quality/Episode Selection Message ID
                    state.set(qMsg.key.id, { qList, pick, mediaType, lastSelectedLink: pick.link });
                } else {
                    await bot.sendMessage(from, { text: "❌ No download/episode links found for this item." }, { quoted: m });
                }
                
                return;
            }

            // --- 2. QUALITY/EPISODE SELECTION (Replied to qMsg) ---
            if (state.has(quotedId)) {
                const { qList, pick, mediaType } = state.get(quotedId);

                const chosen = qList.find(x => x.n === parseInt(text));
                if (!chosen) {
                    await bot.sendMessage(from, { text: "❌ Invalid selection number." }, { quoted: m });
                    return;
                }
                
                // --- If the selection is a TV Episode (needs episode-details API call) ---
                if (chosen.is_episode) {
                    await bot.sendMessage(from, { react: { text: "🔎", key: m.key } });

                    const episodeInfoURL = `${EPISODE_DETAIL_API}url=${encodeURIComponent(chosen.link)}&apiKey=${API_KEY}`;
                    let episodeInfo;
                    try {
                         episodeInfo = await axios.get(episodeInfoURL);
                    } catch (e) {
                        l(e);
                        await bot.sendMessage(from, { text: "❌ Failed to load episode details." }, { quoted: m });
                        return;
                    }
                    
                    const episodeData = episodeInfo.data?.data || {};

                    // Prepare download links for the episode
                    let newQList = (episodeData.download_links || []).map((x, i) => ({
                        n: i + 1,
                        quality: x.quality,
                        size: x.size,
                        link: x.link,
                        is_download: true
                    }));
                    
                    if (newQList.length > 0) {
                        // Send new quality selection message for the episode
                        let newQTxt = `*📥 Choose Quality for: ${chosen.title}*\n\n`;
                        for (const q of newQList) newQTxt += `${q.n} ❱❱ **${q.quality}** ➛ _${q.size}_\n`;
                        newQTxt += "\n⭐❰ZOMBIE MOVIE❱⭐";
                        
                        const newQMsg = await bot.sendMessage(from, {
                            caption: newQTxt,
                        }, { quoted: m });
                        
                        // Update state with new qList for the episode
                        state.set(newQMsg.key.id, { 
                            qList: newQList, 
                            pick: { ...pick, title: `${pick.title} - ${chosen.title}` }, // Update title for filename
                            mediaType: 'download', 
                            lastSelectedLink: chosen.link
                        });
                        
                        // Delete the old state (TV Show/Season state)
                        state.delete(quotedId);

                    } else {
                        await bot.sendMessage(from, { text: `❌ No download links found for episode: ${chosen.title}` }, { quoted: m });
                    }
                    return;
                }

                // --- If the selection is a direct download link (Movie or Episode Quality) ---
                if (chosen.is_download) {
                    // Remove the state entry after selection to prevent multiple downloads
                    state.delete(quotedId);

                    await bot.sendMessage(from, { react: { text: "⏳", key: m.key } });

                    let downloadUrl = chosen.link;

                    try {
                        // Use the download API to get the final direct link
                        const finalDownloadInfo = await axios.get(
                            `${DOWNLOAD_API}url=${encodeURIComponent(downloadUrl)}&apiKey=${API_KEY}`
                        );
                        
                        const finalLink = finalDownloadInfo.data?.data?.downloadUrl;
                        
                        if (!finalLink) throw new Error("Could not retrieve final download URL.");
                        
                        // Send the direct download link
                        await bot.sendMessage(from, {
                            text: `*✅ Download Link Ready!*\n\nTitle: ${pick.title}\nQuality: ${chosen.quality}\n\n*🔗 Direct Download:* ${finalLink}`
                        }, { quoted: m });

                        await bot.sendMessage(from, { react: { text: "✅", key: m.key } });

                    } catch (error) {
                        l(error);
                        await bot.sendMessage(from, { text: "❌ Failed to generate the final download link. Please try again." }, { quoted: m });
                        await bot.sendMessage(from, { react: { text: "❌", key: m.key } });
                    }
                }
            }
        };

        bot.ev.on("messages.upsert", handler);

    } catch (e) {
        await bot.sendMessage(from, { text: "❌ Error: " + e.message }, { quoted: msg });
    }
});
