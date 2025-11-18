// --- Imports and Initialization ---

const log = console.log;
const config = require('../config');
const { cmd } = require('../command');
const axios = require('axios');
const NodeCache = require('node-cache');

// --- API Configuration ---
const API_BASE = 'https://sadaslk-apis.vercel.app/api/v1/movie/sinhalasub/';
const API_KEY = 'c56182a993f60b4f49cf97ab09886d17';
const SEARCH_API = `${API_BASE}search?apiKey=${API_KEY}&q=`; // Search API
const DOWNLOAD_API = `${API_BASE}infodl?apiKey=${API_KEY}&q=`; // Movie/Info DL API

const searchCache = new NodeCache({ 'stdTTL': 60, 'checkperiod': 120 });
const BRAND = '' + config.MOVIE_FOOTER;
const downloadOptionsMap = new Map();


// --- Command Definition ---

cmd({
    pattern: 'sinhalasub',
    react: '🎬',
    desc: 'Search and download Movies/TV Series',
    category: 'download',
    filename: __filename
}, async (
    conn,           
    message,        
    match,          
    { from, q: searchQuery } 
) => {
    // 1. Check for search query
    if (!searchQuery) {
        await conn.sendMessage(from, {
            text: '*🎬 Movie / TV Series Search*\n\n' +
                  '*💡 Type Your Movie ㋡*\n' +
                  '📝 Example: .sinhalasub Breaking Bad\n\n' +
                  '📋 Usage: .sinhalasub <search term>\n'
        }, { quoted: message });
        return;
    }

    try {
        const cacheKey = 'film_' + searchQuery.toLowerCase().trim();
        let searchData = searchCache.get(cacheKey);

        // 2. Search for the movie/series (or fetch from cache)
        if (!searchData) {
            const apiUrl = SEARCH_API + encodeURIComponent(searchQuery); 
            let retries = 3;
            while (retries--) {
                try {
                    const response = await axios.get(apiUrl, { 'timeout': 10000 });
                    searchData = response.data;
                    break;
                } catch (error) {
                    if (!retries) throw new Error('Failed to retrieve data');
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            // Check for results (using the 'data' structure)
            if (!searchData || !searchData.data || searchData.data.length === 0) { 
                throw new Error('No results found.');
            }

            searchCache.set(cacheKey, searchData);
        }

        // 3. Process and display results
        const searchResults = searchData.data.map((item, index) => ({
            n: index + 1,
            title: item.title,
            imdb: item.imdb,
            year: item.year,
            link: item.link, 
            image: item.image 
        }));

        let responseText = '*🎬 SEARCH RESULTS*\n\n';
        for (const result of searchResults) {
            responseText += `${result.n}. *${result.title}* • ⭐ IMDB: ${result.imdb} • 📅 Year: ${result.year}\n\n`;
        }
        responseText += '🔢 Select number 🪀';

        // [--- නිවැරදි කරන ලද කොටස ---]
        let messageOptions = { caption: responseText };

        // 🖼️ Error එක මඟහැරීමට image URL එකක් ඇත්දැයි පරීක්ෂා කිරීම.
        if (searchResults[0] && searchResults[0].image) {
            messageOptions.image = { url: searchResults[0].image };
        }
        
        // Send the search results message (Line 90 පමණ)
        const searchMessage = await conn.sendMessage(from, messageOptions, { quoted: message });
        // [---------------------------]

        // 4. Set up listener for follow-up message (Movie Selection)
        const messageHandler = async ({ messages: newMessages }) => {
            const incomingMessage = newMessages?.[0];
            
            if (!incomingMessage?.message?.extendedTextMessage?.text) return;
            
            const messageText = incomingMessage.message.extendedTextMessage.text.trim();
            const quotedMessageId = incomingMessage.message.extendedTextMessage.contextInfo?.stanzaId;

            // Handle 'off' command
            if (messageText.toLowerCase() === 'off') {
                conn.ev.off('messages.upsert', messageHandler); 
                downloadOptionsMap.clear(); 
                await conn.sendMessage(from, { text: 'OK.' }, { quoted: incomingMessage });
                return;
            }

            // --- First follow-up: Movie Selection ---
            if (quotedMessageId === searchMessage.key.id) {
                const selectedNumber = parseInt(messageText);

                if (isNaN(selectedNumber)) {
                    await conn.sendMessage(from, { text: '❌ Invalid number.' }, { quoted: incomingMessage });
                    return;
                }
                
                const selectedFilm = searchResults.find(item => item.n === selectedNumber);

                if (!selectedFilm) {
                    await conn.sendMessage(from, { text: '❌ Invalid number.' }, { quoted: incomingMessage });
                    return;
                }

                // Download API Call (Info/DL)
                const downloadApiUrl = DOWNLOAD_API + encodeURIComponent(selectedFilm.link);
                let downloadData, retries = 3;

                while (retries--) {
                    try {
                        downloadData = (await axios.get(downloadApiUrl, { 'timeout': 10000 })).data;
                        if (!downloadData.status) throw new Error();
                        break;
                    } catch {
                        if (!retries) {
                            await conn.sendMessage(from, { text: '❌ Fetch failed.' }, { quoted: incomingMessage });
                            return;
                        }
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                }

                // Get download links from the new API structure
                const downloadLinks = downloadData.data.download_links; 
                const qualityPicks = [];
                
                // Find SD and HD options
                const sdOption = downloadLinks.find(item => item.quality.includes('480p') && item.direct_download);
                const hdOption = downloadLinks.find(item => item.quality.includes('1080p') && item.direct_download) ||
                                 downloadLinks.find(item => item.quality.includes('720p') && item.direct_download);

                if (sdOption) qualityPicks.push({ n: 1, q: 'SD', ...sdOption });
                if (hdOption) qualityPicks.push({ n: 2, q: 'HD', ...hdOption });

                if (!qualityPicks.length) {
                    await conn.sendMessage(from, { text: '❌ No links.' }, { quoted: incomingMessage });
                    return;
                }

                // Format the quality selection message
                let qualityText = `*🎬 ${selectedFilm.title}*\n\n📥 Choose Quality:\n\n`;
                for (const pick of qualityPicks) {
                    qualityText += `${pick.n}. *${pick.q}* (${pick.quality}) (📊 Size: ${pick.size})\n`;
                }
                qualityText += '\n*~https://whatsapp.com/channel/0029Vb5xFPHGE56jTnm4ZD2k~*';

                // Send quality selection message
                const qualityMessage = await conn.sendMessage(from, {
                    image: { url: downloadData.data.image || selectedFilm.image }, 
                    caption: qualityText
                }, { quoted: incomingMessage });

                // Store options for the next step
                downloadOptionsMap.set(qualityMessage.key.id, { film: selectedFilm, picks: qualityPicks });
                return;
            }

            // --- Second follow-up: Quality Selection ---
            if (downloadOptionsMap.has(quotedMessageId)) {
                const { film, picks: qualityPicks } = downloadOptionsMap.get(quotedMessageId);
                const selectedPick = qualityPicks.find(item => item.n === parseInt(messageText));

                if (!selectedPick) {
                    await conn.sendMessage(from, { text: '❌ Wrong quality.' }, { quoted: incomingMessage });
                    return;
                }

                // Size check (2GB Limit)
                const sizeLower = selectedPick.size.toLowerCase();
                const sizeInGB = sizeLower.includes('gb') ? parseFloat(sizeLower) : parseFloat(sizeLower) / 1024;
                
                if (sizeInGB > 2) {
                    await conn.sendMessage(from, { 
                        text: '⚠️ Too large. Direct link:\n' + selectedPick.direct_download 
                    }, { quoted: incomingMessage });
                    return;
                }

                // Prepare file details
                const cleanFileName = film.title.replace(/[\\/:*?"<>|]/g, ''); 
                const finalFileName = `🎥 ${cleanFileName}.mp4 - ${selectedPick.q} (KAVI ツ • )`;

                try {
                    // Send the document (video)
                    await conn.sendMessage(from, {
                        document: { url: selectedPick.direct_download },
                        mimetype: 'video/mp4',
                        fileName: finalFileName,
                        caption: `*🎬 ${film.title}*\n\n📊 Size: ${selectedPick.size}\n\n${config.MOVIE_FOOTER}`
                    }, { quoted: incomingMessage });
                    
                    // Add a success reaction
                    await conn.sendMessage(from, { react: { text: '✅', key: incomingMessage.key } });

                } catch (e) {
                    // Fallback to direct link if sending the document fails
                    await conn.sendMessage(from, {
                        text: '❌ Failed. Direct link:\n' + selectedPick.direct_download
                    }, { quoted: incomingMessage });
                }
            }
        };

        // Attach the message handler to the 'messages.upsert' event
        conn.ev.on('messages.upsert', messageHandler);

    } catch (error) {
        log('error', error);
        await conn.sendMessage(from, { text: '❌ Error: ' + error.message }, { quoted: message });
    }
});
