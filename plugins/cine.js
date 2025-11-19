/*
 * NOTE: Original variable/function names preserved
 */

const l = console.log;
const config = require('../config'); 
const { cmd } = require('../command');
const axios = require('axios');
const NodeCache = require('node-cache');

const API_KEY = '25f974dba76310042bcd3c9488eec9093816ef32eb36d34c1b6b875ac9215932';
const SEARCH_API = 'https://foreign-marna-sithaunarathnapromax-9a005c2e.koyeb.app/api/cinesubz/search?q=';
const MOVIE_DL_API = 'https://foreign-marna-sithaunarathnapromax-9a005c2e.koyeb.app/api/cinesubz/movie-details?url=';
const TV_DL_API = 'https://foreign-marna-sithaunarathnapromax-9a005c2e.koyeb.app/api/cinesubz/tvshow-details?url=';

const searchCache = new NodeCache({ 'stdTTL': 60, 'checkperiod': 120 });
const BRAND = config.MOVIE_FOOTER;

// -------------------------
// ✅ Pixeldrain direct download fix
// -------------------------
function fixPixelDrain(url) {
    if (!url.includes("/u/")) return url; // Already direct or other host
    const id = url.split("/u/")[1];
    return `https://pixeldrain.com/api/file/${id}?download`;
}

cmd({
    'pattern': 'cinesubz',
    'react': '🎬',
    'desc': 'Search and download Movies/TV Series from Cinesubz',
    'category': 'download',
    'filename': __filename
}, async (bot, message, context, { from, q: searchQuery }) => {

    if (!searchQuery) {
        await bot.sendMessage(from, {
            'text': '*💡 Type Your Movie ㋡*\n\n📋 Usage: .cinesubz <search term>\n📝 Example: .cinesubz Breaking Bad\n\n' + '*🎬 Movie / TV Series Search*'
        }, { 'quoted': message });
        return;
    }

    try {
        const cacheKey = 'film_' + searchQuery.toLowerCase().trim();
        let apiData = searchCache.get(cacheKey);

        if (!apiData) {
            const searchUrl = `${SEARCH_API}${encodeURIComponent(searchQuery)}&apiKey=${API_KEY}`;
            
            let retries = 3;
            while (retries--) {
                try {
                    const response = await axios.get(searchUrl, { 'timeout': 10000 });
                    apiData = response.data;
                    break;
                } catch (error) {
                    if (!retries) throw new Error('❌ Fetch failed.');
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            if (!apiData?.status || !apiData?.data?.length) throw new Error('No results found.');
            searchCache.set(cacheKey, apiData);
        }

        const results = apiData.data.map((item, index) => ({
            'n': index + 1,
            'title': item.Title,
            'imdb': item.Rating || 'N/A',
            'year': item.Year || 'N/A',
            'link': item.Link,
            'image': item.Img
        }));

        let replyText = '*🎬 SEARCH RESULTS*\n\n';
        for (const item of results) {
            replyText += `🎬 *${item.n}. ${item.title}*\n  ⭐ Rating: ${item.imdb}\n  📅 Year: ${item.year}\n\n`;
        }
        replyText += '🔢 Select number 🪀';

        const sentMessage = await bot.sendMessage(from, {
            'image': { 'url': results[0].image },
            'caption': replyText
        }, { 'quoted': message });

        const stateMap = new Map();

        const selectionHandler = async ({ messages }) => {
            const incomingMessage = messages?.[0];
            if (!incomingMessage?.message?.extendedTextMessage) return;

            const text = incomingMessage.message.extendedTextMessage.text.trim();
            const quotedId = incomingMessage.message.extendedTextMessage.contextInfo?.stanzaId;
            
            if (text.toLowerCase() === 'off') {
                bot.ev.off('messages.upsert', selectionHandler);
                stateMap.clear();
                await bot.sendMessage(from, { 'text': 'OK.' }, { 'quoted': incomingMessage });
                return;
            }

            if (quotedId === sentMessage.key.id) {

                const selectedFilm = results.find(item => item.n === parseInt(text));
                if (!selectedFilm) {
                    await bot.sendMessage(from, { 'text': '❌ Invalid number.' }, { 'quoted': incomingMessage });
                    return;
                }

                const isTvEpisode = selectedFilm.link.includes('/episodes/');
                const dlBaseUrl = isTvEpisode ? TV_DL_API : MOVIE_DL_API;
                const downloadUrl = `${dlBaseUrl}url=${encodeURIComponent(selectedFilm.link)}&apiKey=${API_KEY}`;

                let downloadData;
                let retries = 3;
                while (retries--) {
                    try {
                        downloadData = (await axios.get(downloadUrl, { 'timeout': 10000 })).data;
                        if (!downloadData.status) throw new Error();
                        break;
                    } catch {
                        if (!retries) {
                            await bot.sendMessage(from, { 'text': '❌ Error: Failed to retrieve data' }, { 'quoted': incomingMessage });
                            return;
                        }
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                }

                let downloadLinks = [];
                let thumbnailUrl = selectedFilm.image;
                
                if (isTvEpisode) {
                    downloadLinks = downloadData.data.filter(link => 
                        link.finalDownloadUrl && 
                        (link.host === 'DLServer-01' || link.host === 'DLServer-02' || link.host === 'Usersdrive')
                    ).map(link => ({
                        'quality': link.quality,
                        'size': 'N/A',
                        'link': link.finalDownloadUrl
                    }));
                } else {
                    downloadLinks = downloadData.data.downloadLinks;
                    thumbnailUrl = downloadData.data.images?.[0] || selectedFilm.image; 
                }

                const picks = [];
                const availableQualities = {};

                for (let i = 0; i < downloadLinks.length; i++) {
                    const link = downloadLinks[i];
                    const quality = link.quality;
                    const size = link.size || 'N/A';
                    const directLink = link.link;

                    if (directLink) {
                        const qKey = quality.toUpperCase().replace(/\s/g, '');
                        let priority = 0;

                        if (qKey.includes('1080P') || qKey.includes('FHD')) priority = 3;
                        else if (qKey.includes('720P') || qKey.includes('HD')) priority = 2;
                        else if (qKey.includes('480P') || qKey.includes('SD')) priority = 1;

                        if (!availableQualities[qKey] || availableQualities[qKey].priority < priority) {
                            availableQualities[qKey] = { quality, size, direct_download: directLink, priority };
                        }
                    }
                }

                const sortedPicks = Object.values(availableQualities)
                    .sort((a, b) => b.priority - a.priority)
                    .slice(0, 5);

                for (let i = 0; i < sortedPicks.length; i++) {
                    picks.push({ 'n': i + 1, ...sortedPicks[i] });
                }

                if (!picks.length) {
                    await bot.sendMessage(from, { 'text': '❌ No usable download links found.' }, { 'quoted': incomingMessage });
                    return;
                }

                let qualityReply = `*🎬 ${selectedFilm.title}*\n\n📥 Choose Quality:\n\n`;
                for (const pick of picks) {
                    qualityReply += `${pick.n}. *${pick.quality}* • ${pick.size})\n`;
                }
                qualityReply += '\n*~https://whatsapp.com/channel/0029Vb5xFPHGE56jTnm4ZD2k~*';

                const qualityMessage = await bot.sendMessage(from, {
                    'image': { 'url': thumbnailUrl },
                    'caption': qualityReply
                }, { 'quoted': incomingMessage });

                stateMap.set(qualityMessage.key.id, { 'film': selectedFilm, 'picks': picks });
                return;
            }

            if (stateMap.has(quotedId)) {
                const { film, picks } = stateMap.get(quotedId);
                const selectedQuality = picks.find(item => item.n === parseInt(text));

                if (!selectedQuality) {
                    await bot.sendMessage(from, { 'text': '❌ Wrong quality.' }, { 'quoted': incomingMessage });
                    return;
                }

                const sizeLower = selectedQuality.size ? selectedQuality.size.toLowerCase() : '0mb';
                let sizeInGB = 3; 
                if (sizeLower.includes('gb')) sizeInGB = parseFloat(sizeLower) || 3;
                else if (sizeLower.includes('mb')) sizeInGB = (parseFloat(sizeLower) || 0
