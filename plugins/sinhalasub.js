/*
 * Advanced SinhalaSub Bot Command – API Safe Version
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

const searchCache = new NodeCache({ stdTTL: 60, checkperiod: 120 });

// -------------------------
// Pixeldrain direct download fix
// -------------------------
function fixPixelDrain(url) {
    if (!url.includes("/u/")) return url;
    const id = url.split("/u/")[1];
    return `https://pixeldrain.com/api/file/${id}?download`;
}

cmd({
    pattern: 'sinhalasub',
    react: '🎬',
    desc: 'Search and download Movies/TV Series with advanced features',
    category: 'download',
    filename: __filename
}, async (bot, message, context, { from, q: searchQuery }) => {

    if (!searchQuery) {
        await bot.sendMessage(from, {
            text: '*💡 Type Your Movie ㋡*\n\n📋 Usage: .sinhalasub <search term>\n📝 Example: .sinhalasub Breaking Bad\n\n🎬 Movie / TV Series Search'
        }, { quoted: message });
        return;
    }

    try {
        const cacheKey = 'film_' + searchQuery.toLowerCase().trim();
        let apiData = searchCache.get(cacheKey);

        if (!apiData) {
            const searchUrl = `${SEARCH_API}q=${encodeURIComponent(searchQuery)}&apiKey=${API_KEY}`;
            let response;
            try {
                response = await axios.get(searchUrl, { timeout: 10000 });
            } catch (err) {
                throw new Error('❌ Failed to fetch search results.');
            }

            // ✅ Safe response check
            if (!response?.data) throw new Error('❌ No results returned from API.');
            
            // API may return different structures
            const dataList = response.data.data || response.data.results || [];
            if (!dataList.length) throw new Error('❌ No results found.');

            apiData = { status: true, data: dataList };
            searchCache.set(cacheKey, apiData);
        }

        // Map results with extra details if available
        const results = apiData.data.map((item, index) => ({
            n: index + 1,
            title: item.Title || item.title || 'N/A',
            imdb: item.Rating || item.imdb || 'N/A',
            year: item.Year || item.year || 'N/A',
            genre: item.Genre || item.genre || 'N/A',
            plot: item.Plot || item.plot || 'N/A',
            link: item.Link || item.link,
            image: item.Img || item.image || 'https://i.imgur.com/SL4nVxv.png'
        }));

        let replyText = '*🎬 SEARCH RESULTS*\n\n';
        for (const item of results) {
            replyText += `🎬 *${item.n}. ${item.title}*\n`;
            replyText += `📅 Year: ${item.year}\n`;
            replyText += `⭐ IMDb: ${item.imdb}\n`;
            replyText += `🎭 Genre: ${item.genre}\n`;
            replyText += `📝 Plot: ${item.plot.substring(0, 150)}...\n\n`;
        }
        replyText += '🔢 Select number 🪀';

        const sentMessage = await bot.sendMessage(from, {
            image: { url: results[0].image },
            caption: replyText
        }, { quoted: message });

        const stateMap = new Map();

        const selectionHandler = async ({ messages }) => {
            const incomingMessage = messages?.[0];
            if (!incomingMessage?.message?.extendedTextMessage) return;

            const text = incomingMessage.message.extendedTextMessage.text.trim();
            const quotedId = incomingMessage.message.extendedTextMessage.contextInfo?.stanzaId;

            if (text.toLowerCase() === 'off') {
                bot.ev.off('messages.upsert', selectionHandler);
                stateMap.clear();
                await bot.sendMessage(from, { text: 'OK.' }, { quoted: incomingMessage });
                return;
            }

            if (quotedId === sentMessage.key.id) {
                const selectedFilm = results.find(item => item.n === parseInt(text));
                if (!selectedFilm) {
                    await bot.sendMessage(from, { text: '❌ Invalid number.' }, { quoted: incomingMessage });
                    return;
                }

                const isTvEpisode = selectedFilm.link.includes('/episodes/');
                const dlBaseUrl = isTvEpisode ? TV_DL_API : MOVIE_DL_API;
                const downloadUrl = `${dlBaseUrl}q=${encodeURIComponent(selectedFilm.link)}&apiKey=${API_KEY}`;

                let downloadData;
                try {
                    const dlResp = await axios.get(downloadUrl, { timeout: 10000 });
                    downloadData = dlResp?.data;
                    if (!downloadData?.status) throw new Error();
                } catch {
                    await bot.sendMessage(from, { text: '❌ Error: Failed to retrieve data' }, { quoted: incomingMessage });
                    return;
                }

                let downloadLinks = [];
                let thumbnailUrl = selectedFilm.image;

                if (isTvEpisode) {
                    downloadLinks = downloadData.data?.filter(l => l.finalDownloadUrl).map(ep => ({
                        quality: ep.quality,
                        size: ep.size || 'N/A',
                        link: ep.finalDownloadUrl,
                        episode: ep.episode || 'Ep1'
                    })) || [];
                } else {
                    downloadLinks = downloadData.data?.downloadLinks || [];
                    thumbnailUrl = downloadData.data?.images?.[0] || selectedFilm.image;
                }

                const availableQualities = {};
                for (let i = 0; i < downloadLinks.length; i++) {
                    const link = downloadLinks[i];
                    const qKey = (link.quality || 'N/A').toUpperCase().replace(/\s/g, '');
                    let priority = 0;
                    if (qKey.includes('1080P') || qKey.includes('FHD')) priority = 3;
                    else if (qKey.includes('720P') || qKey.includes('HD')) priority = 2;
                    else if (qKey.includes('480P') || qKey.includes('SD')) priority = 1;

                    if (!availableQualities[qKey] || availableQualities[qKey].priority < priority) {
                        availableQualities[qKey] = { quality: link.quality, size: link.size, direct_download: link.link, priority, episode: link.episode };
                    }
                }

                const picks = Object.values(availableQualities)
                    .sort((a, b) => b.priority - a.priority)
                    .slice(0, 5)
                    .map((p, i) => ({ n: i + 1, ...p }));

                if (!picks.length) {
                    await bot.sendMessage(from, { text: '❌ No usable download links found.' }, { quoted: incomingMessage });
                    return;
                }

                let qualityReply = `*🎬 ${selectedFilm.title}*\n\n📥 Choose Quality:\n\n`;
                for (const pick of picks) {
                    qualityReply += `${pick.n}. *${pick.quality}* • ${pick.size}\n`;
                }
                qualityReply += '\n*~https://whatsapp.com/channel/0029Vb5xFPHGE56jTnm4ZD2k~*';

                const qualityMessage = await bot.sendMessage(from, {
                    image: { url: thumbnailUrl },
                    caption: qualityReply
                }, { quoted: incomingMessage });

                stateMap.set(qualityMessage.key.id, { film: selectedFilm, picks, isTvEpisode });

                return;
            }

            if (stateMap.has(quotedId)) {
                const { film, picks, isTvEpisode } = stateMap.get(quotedId);
                const selectedQuality = picks.find(p => p.n === parseInt(text));
                if (!selectedQuality) {
                    await bot.sendMessage(from, { text: '❌ Wrong quality.' }, { quoted: incomingMessage });
                    return;
                }

                if (isTvEpisode) {
                    for (const ep of downloadLinks.filter(l => l.quality === selectedQuality.quality)) {
                        const fileBuffer = await axios.get(fixPixelDrain(ep.link), { responseType: 'arraybuffer', timeout: 60000 }).then(r => r.data);
                        await bot.sendMessage(from, {
                            document: fileBuffer,
                            mimetype: 'video/mp4',
                            fileName: `🎥 ${film.title} • ${ep.episode}.${selectedQuality.quality}.mp4`,
                            caption: `🎬 ${film.title} • ${ep.episode} • ${selectedQuality.quality}\n${config.MOVIE_FOOTER}`
                        }, { quoted: incomingMessage });
                    }
                    await bot.sendMessage(from, { react: { text: "✅", key: incomingMessage.key } });
                    return;
                }

                const fileBuffer = await axios.get(fixPixelDrain(selectedQuality.direct_download), { responseType: 'arraybuffer', timeout: 60000 }).then(r => r.data);
                await bot.sendMessage(from, {
                    document: fileBuffer,
                    mimetype: 'video/mp4',
                    fileName: `🎥 ${film.title}.${selectedQuality.quality}.mp4`,
                    caption: `🎬 ${film.title} • ${selectedQuality.quality}\n${config.MOVIE_FOOTER}`
                }, { quoted: incomingMessage });

                await bot.sendMessage(from, { react: { text: "✅", key: incomingMessage.key } });
            }
        };

        bot.ev.on('messages.upsert', selectionHandler);

    } catch (err) {
        l(err);
        await bot.sendMessage(from, { text: '❌ Error: ' + err.message }, { quoted: message });
    }
});
