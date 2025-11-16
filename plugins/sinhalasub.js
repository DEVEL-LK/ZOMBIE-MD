/*
 * NOTE: The original variable/function names are placeholders.
 * Actual names (like 'l' for console.log) are preserved where clear.
 * The string array lookup (_0x2ae8a6(xxx)) is replaced with the actual string.
 */

const l = console.log;
const config = require('../config'); // Loads configuration
const { cmd } = require('../command'); // Bot command framework
const axios = require('axios'); // HTTP client for API calls
const NodeCache = require('node-cache'); // Cache for search results

// Cache search results for 60 seconds (stdTTL: 0x3c)
const searchCache = new NodeCache({ 'stdTTL': 60, 'checkperiod': 120 });
const BRAND = config.MOVIE_FOOTER; // Likely a brand/footer string

// --- Main Command Definition ---
cmd({
    'pattern': 'sinhalasub',
    'react': '🎬',
    'desc': 'Search and download Movies/TV Series',
    'category': 'download',
    'filename': __filename
}, async (bot, message, context, { from, q: searchQuery }) => {
    // 1. Handle No Search Query
    if (!searchQuery) {
        await bot.sendMessage(from, {
            'text': '*💡 Type Your Movie ㋡*\n\n📋 Usage: .sinhalasub <search term>\n📝 Example: .sinhalasub Breaking Bad\n\n' + '*🎬 Movie / TV Series Search*'
        }, { 'quoted': message });
        return;
    }

    try {
        const cacheKey = 'film_' + searchQuery.toLowerCase().trim();
        let apiData = searchCache.get(cacheKey);

        // 2. Search Logic (API Call & Caching)
        if (!apiData) {
            const searchUrl = 'https://apis.davidcyriltech.my.id/movies/search?query=' + encodeURIComponent(searchQuery);
            let retries = 3;
            while (retries--) {
                try {
                    const response = await axios.get(searchUrl, { 'timeout': 10000 }); // 10s timeout
                    apiData = response.data;
                    break;
                } catch (error) {
                    if (!retries) throw new Error('❌ Fetch failed.');
                    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retry
                }
            }

            if (!apiData?.status || !apiData?.results?.length) {
                throw new Error('No results found.');
            }
            searchCache.set(cacheKey, apiData);
        }

        // 3. Format Search Results for Display
        const results = apiData.results.map((item, index) => ({
            'n': index + 1,
            'title': item.title,
            'imdb': item.imdb,
            'year': item.year,
            'link': item.link,
            'image': item.thumbnail
        }));

        let replyText = '*🎬 SEARCH RESULTS*\n\n';
        for (const item of results) {
            replyText += `🎬 *${item.n}. ${item.title}*\n  ⭐ IMDB: ${item.imdb}\n  📅 Year: ${item.year}\n\n`;
        }
        replyText += '🔢 Select number 🪀';

        // 4. Send Results and Setup Interactive Listener
        const sentMessage = await bot.sendMessage(from, {
            'image': { 'url': results[0].image }, // Use first result's thumbnail
            'caption': replyText
        }, { 'quoted': message });

        const stateMap = new Map(); // Used to store film/picks data for the next step

        // Listener for user's selection (reply to the message)
        const selectionHandler = async ({ messages }) => {
            const incomingMessage = messages?.[0];
            if (!incomingMessage?.message?.extendedTextMessage) return;

            const text = incomingMessage.message.extendedTextMessage.text.trim();
            const quotedId = incomingMessage.message.extendedTextMessage.contextInfo?.stanzaId;
            
            // Check for exit keyword or if the reply is to the search result message
            if (text.toLowerCase() === 'off') {
                bot.ev.off('messages.upsert', selectionHandler);
                stateMap.clear();
                await bot.sendMessage(from, { 'text': 'OK.' }, { 'quoted': incomingMessage });
                return;
            }

            if (quotedId === sentMessage.key.id) {
                // --- Movie Selection (First Stage) ---
                const selectedFilm = results.find(item => item.n === parseInt(text));

                if (!selectedFilm) {
                    await bot.sendMessage(from, { 'text': '❌ Invalid number.' }, { 'quoted': incomingMessage });
                    return;
                }

                // 5. Fetch Download Links
                const downloadUrl = 'https://apis.davidcyriltech.my.id/movies/download?url=' + encodeURIComponent(selectedFilm.link);
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

                const downloadLinks = downloadData.data.download_links;

                // 6. Filter & Format Available Quality Options (SD 480p and HD 720p/FHD 1080p)
                const picks = [];
                const sdOption = downloadLinks.find(d => d.quality === 'SD 480p' && d.direct_download);
                const hdOption = downloadLinks.find(d => d.quality === 'HD 720p' && d.direct_download) || 
                                 downloadLinks.find(d => d.quality === 'FHD 1080p' && d.direct_download);

                if (sdOption) picks.push({ 'n': 1, 'q': 'SD', ...sdOption });
                if (hdOption) picks.push({ 'n': 2, 'q': 'HD', ...hdOption });
                
                if (!picks.length) {
                    await bot.sendMessage(from, { 'text': '❌ No links.' }, { 'quoted': incomingMessage });
                    return;
                }

                let qualityReply = `*🎬 ${selectedFilm.title}*\n\n📥 Choose Quality:\n\n`;
                for (const pick of picks) {
                    qualityReply += `${pick.n}. *${pick.q} • ${pick.size})*\n`;
                }
                qualityReply += '\n*~https://whatsapp.com/channel/0029Vb5xFPHGE56jTnm4ZD2k~*';

                // 7. Send Quality Selection Message
                const qualityMessage = await bot.sendMessage(from, {
                    'image': { 'url': downloadData.data.thumbnail || selectedFilm.image },
                    'caption': qualityReply
                }, { 'quoted': incomingMessage });

                // Store film and quality options for the next step
                stateMap.set(qualityMessage.key.id, { 'film': selectedFilm, 'picks': picks });
                return;
            }

            // --- Quality Selection (Second Stage) ---
            if (stateMap.has(quotedId)) {
                const { film, picks } = stateMap.get(quotedId);
                const selectedQuality = picks.find(item => item.n === parseInt(text));

                if (!selectedQuality) {
                    await bot.sendMessage(from, { 'text': '❌ Wrong quality.' }, { 'quoted': incomingMessage });
                    return;
                }

                // 8. Size Check (Limit downloads to 2GB or less)
                const sizeLower = selectedQuality.size.toLowerCase();
                // Check if size is > 2GB (or > 2048MB if in MB)
                const sizeInGB = sizeLower.includes('gb') ? parseFloat(sizeLower) : parseFloat(sizeLower) / 1024; 
                
                if (sizeInGB > 2) { 
                    await bot.sendMessage(from, { 'text': '⚠️ Too large. Direct link:\n' + selectedQuality.direct_download }, { 'quoted': incomingMessage });
                    return;
                }

                // 9. Prepare and Send File
                const safeTitle = film.title.replace(/[\\/:*?"<>|]/g, '');
                const fileName = `🎥 ${safeTitle}.${selectedQuality.q}.mp4`;

                try {
                    await bot.sendMessage(from, {
                        'document': { 'url': selectedQuality.direct_download },
                        'mimetype': 'video/mp4',
                        'fileName': fileName,
                        'caption': `*🎬 ${film.title}*\n*📊 Size: ${selectedQuality.size}\n\n${config.MOVIE_FOOTER}`
                    }, { 'quoted': incomingMessage });
                    await bot.sendMessage(from, { 'react': { 'text': '✅', 'key': incomingMessage.key } });
                } catch {
                    await bot.sendMessage(from, { 'text': '❌ Failed. Direct link:\n' + selectedQuality.direct_download }, { 'quoted': incomingMessage });
                }
            }
        };
        
        // Start listening for the user's reply
        bot.ev.on('messages.upsert', selectionHandler);

    } catch (error) {
        l(error);
        await bot.sendMessage(from, { 'text': '❌ Error: ' + error.message }, { 'quoted': message });
    }
});

// --- Obfuscation Functions (Removed/Ignored for Clarity) ---
// The functions _0x5de8, _0x32f8, _0x1d6c6b, _0x59854b, _0x4082be, and _0x4e86ba 
// are part of the obfuscation layer and are not needed for core functionality.
