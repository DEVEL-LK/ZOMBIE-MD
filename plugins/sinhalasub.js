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

// --- NEW API CONFIGURATION ---
const API_KEY = 'c56182a993f60b4f49cf97ab09886d17'; // Your API Key
const SEARCH_API = 'https://sadaslk-apis.vercel.app/api/v1/movie/sinhalasub/search?';
const MOVIE_DL_API = 'https://sadaslk-apis.vercel.app/api/v1/movie/sinhalasub/infodl?';
const TV_DL_API = 'https://sadaslk-apis.vercel.app/api/v1/movie/sinhalasub/tv/dl?';
// -----------------------------

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
            // --- UPDATED SEARCH API CALL ---
            const searchUrl = `${SEARCH_API}q=${encodeURIComponent(searchQuery)}&apiKey=${API_KEY}`;
            
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

            // NOTE: Assuming your API returns 'status' and 'results' similar to the old one.
            if (!apiData?.status || !apiData?.results?.length) {
                throw new Error('No results found.');
            }
            searchCache.set(cacheKey, apiData);
        }

        // 3. Format Search Results for Display
        const results = apiData.results.map((item, index) => ({
            'n': index + 1,
            'title': item.title,
            // NOTE: Assuming item.imdb, item.year, item.link, item.thumbnail still exist.
            'imdb': item.imdb || 'N/A', 
            'year': item.year || 'N/A',
            'link': item.link, // This link is crucial for the next stage
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
                
                // Determine if it's a Movie or TV series based on the link (This is an assumption)
                const isTvSeries = selectedFilm.link.includes('/episodes/');

                // 5. Fetch Download Links
                // --- UPDATED DOWNLOAD API CALLS ---
                const dlBaseUrl = isTvSeries ? TV_DL_API : MOVIE_DL_API;
                const downloadUrl = `${dlBaseUrl}q=${encodeURIComponent(selectedFilm.link)}&apiKey=${API_KEY}`;

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
                
                // NOTE: Assuming downloadData.data.download_links contains the required array.
                const downloadLinks = downloadData.data.download_links;

                // 6. Filter & Format Available Quality Options (SD 480p and HD 720p/FHD 1080p)
                const picks = [];
                // The original code only looked for 'SD 480p', 'HD 720p', 'FHD 1080p'
                // This has been generalized slightly to look for any quality link with a direct download
                
                // Group links by quality and prioritize higher resolutions
                const availableQualities = {};
                for (const link of downloadLinks) {
                    if (link.direct_download) {
                        const q = link.quality.toUpperCase().replace(/\s/g, ''); // e.g., 'HD720P'
                        const priority = q.includes('1080P') ? 3 : q.includes('720P') ? 2 : 1;
                        
                        if (!availableQualities[q] || availableQualities[q].priority < priority) {
                            availableQualities[q] = { ...link, priority, q: link.quality };
                        }
                    }
                }
                
                // Assign numbered picks (1, 2, 3...) based on priority/order
                const sortedPicks = Object.values(availableQualities)
                    .sort((a, b) => b.priority - a.priority) // Highest quality first
                    .slice(0, 5); // Limit to 5 options for simplicity

                for (let i = 0; i < sortedPicks.length; i++) {
                    picks.push({ 'n': i + 1, ...sortedPicks[i] });
                }

                if (!picks.length) {
                    await bot.sendMessage(from, { 'text': '❌ No direct download links found.' }, { 'quoted': incomingMessage });
                    return;
                }

                let qualityReply = `*🎬 ${selectedFilm.title}*\n\n📥 Choose Quality:\n\n`;
                for (const pick of picks) {
                    qualityReply += `${pick.n}. *${pick.quality}* • ${pick.size || 'Size N/A'} \n`;
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
                const sizeLower = selectedQuality.size ? selectedQuality.size.toLowerCase() : '0mb';
                
                // Simple size parsing logic (can be complex, kept simple for this update)
                let sizeInGB = 0;
                if (sizeLower.includes('gb')) {
                    sizeInGB = parseFloat(sizeLower) || 0;
                } else if (sizeLower.includes('mb')) {
                    sizeInGB = (parseFloat(sizeLower) || 0) / 1024;
                }
                
                if (sizeInGB > 2) { 
                    await bot.sendMessage(from, { 'text': `⚠️ Too large (${selectedQuality.size}). Direct link:\n` + selectedQuality.direct_download }, { 'quoted': incomingMessage });
                    return;
                }

                // 9. Prepare and Send File
                const safeTitle = film.title.replace(/[\\/:*?"<>|]/g, '');
                const fileName = `🎥 ${safeTitle}.${selectedQuality.quality || 'DL'}.mp4`;

                try {
                    await bot.sendMessage(from, {
                        'document': { 'url': selectedQuality.direct_download },
                        'mimetype': 'video/mp4',
                        'fileName': fileName,
                        'caption': `*🎬 ${film.title}*\n*📊 Quality: ${selectedQuality.quality} • Size: ${selectedQuality.size || 'N/A'}\n\n${config.MOVIE_FOOTER}`
                    }, { 'quoted': incomingMessage });
                    await bot.sendMessage(from, { 'react': { 'text': '✅', 'key': incomingMessage.key } });
                } catch {
                    await bot.sendMessage(from, { 'text': '❌ Failed to send file. Direct link:\n' + selectedQuality.direct_download }, { 'quoted': incomingMessage });
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
// ...
